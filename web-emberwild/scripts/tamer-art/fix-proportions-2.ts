/**
 * Pass 2: raw-art tamers.
 *  - strips every recolor slot: the art ships with its original painted
 *    colors, no palette drives touch it (masks stay — the loader fetches
 *    them, they are simply never consulted)
 *  - shrinks the head to natural proportions (~1/6 of figure height, like
 *    the rival tamers): face + hair art scaled ×0.65 again, anchored at the
 *    chin, which moves up to sit on the shoulders
 *
 * New files get a `_p3` suffix (mask: `_p3_mask.png`, matching the loader's
 * derived mask URL). Run: bun scripts/tamer-art/fix-proportions-2.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { decodePng, encodePng } from "./png";

type Rgba = { w: number; h: number; rgba: Uint8Array };

const base = new URL("../../../web-emberwild/public/tamers/", import.meta.url);
const manifestPath = new URL("../../../web-emberwild/public/tamers/hd/manifest.json", import.meta.url);

const S = 0.65; // head shrink relative to current
const NEW_CHIN = 312; // body top 292 + 20px neck

const M = JSON.parse(readFileSync(manifestPath, "utf8"));

function resize(src: Rgba, dw: number, dh: number, nearest: boolean): Rgba {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = nearest ? Math.min(src.h - 1, Math.floor(((y + 0.5) * src.h) / dh)) : Math.min(src.h - 1, Math.max(0, (y + 0.5) * (src.h / dh) - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(src.h - 1, y0 + 1), fy = nearest ? 0 : sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = nearest ? Math.min(src.w - 1, Math.floor(((x + 0.5) * src.w) / dw)) : Math.min(src.w - 1, Math.max(0, (x + 0.5) * (src.w / dw) - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(src.w - 1, x0 + 1), fx = nearest ? 0 : sx - x0;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (nearest) out[o + c] = src.rgba[(sy * src.w + sx) * 4 + c];
        else {
          const p00 = src.rgba[(y0 * src.w + x0) * 4 + c];
          const p10 = src.rgba[(y0 * src.w + x1) * 4 + c];
          const p01 = src.rgba[(y1 * src.w + x0) * 4 + c];
          const p11 = src.rgba[(y1 * src.w + x1) * 4 + c];
          out[o + c] = Math.round(p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy);
        }
      }
    }
  }
  return { w: dw, h: dh, rgba: out };
}

const cache = new Map<string, Rgba>();
const load = (p: string): Rgba => {
  if (!cache.has(p)) cache.set(p, decodePng(new Uint8Array(readFileSync(new URL(p, base)))));
  return cache.get(p)!;
};
const written = new Set<string>();
const outPath = (art: string): { art: string; mask: string } => ({
  art: art.replace(/\.png$/, "_p3.png"),
  mask: art.replace(/\.png$/, "_p3_mask.png"), // loader derives exactly this
});
const emit = (artP: string, maskP: string, art: Rgba, mask: Rgba): void => {
  if (!written.has(artP)) {
    writeFileSync(new URL(artP, base), encodePng(art.w, art.h, art.rgba));
    writeFileSync(new URL(maskP, base), encodePng(mask.w, mask.h, mask.rgba));
    written.add(artP);
  }
};

type Rect = { dx: number; dy: number; dw: number; dh: number };
function shrink(r: Rect): Rect {
  const dw = Math.round(r.dw * S);
  const dh = Math.round(r.dh * S);
  const cx = r.dx + r.dw / 2;
  const bottom = NEW_CHIN + Math.round((r.dy + r.dh - 359) * S); // 359 = current chin
  return { dx: Math.round(cx - dw / 2), dy: bottom - dh, dw, dh };
}

let minDy = 0;
for (const [key, part] of Object.entries<any>(M.parts)) {
  if (!key.startsWith("face.") && !key.startsWith("hair.")) continue;
  part.slots = []; // raw art: no recoloring
  if (part.variants) {
    for (const v of Object.values<any>(part.variants)) {
      if (!v.art) continue;
      if (load(v.art).w !== v.dw || load(v.art).h !== v.dh) throw new Error(`${v.art}: dims ≠ rect`);
      const nr = shrink(v.rect ?? v);
      const out = outPath(v.art as string);
      emit(out.art, out.mask, resize(load(v.art), nr.dw, nr.dh, false), resize(load(v.mask), nr.dw, nr.dh, true));
      v.art = out.art;
      v.mask = out.mask;
      v.rect = v.rect; // keep variant rect container if present
      Object.assign(v, nr);
      minDy = Math.min(minDy, nr.dy);
    }
  } else {
    if (load(part.art).w !== part.rect.dw || load(part.art).h !== part.rect.dh) throw new Error(`${part.art}: dims ≠ rect`);
    const nr = shrink(part.rect);
    const out = outPath(part.art as string);
    emit(out.art, out.mask, resize(load(part.art), nr.dw, nr.dh, false), resize(load(part.mask), nr.dw, nr.dh, true));
    part.art = out.art;
    part.mask = out.mask;
    part.rect = nr;
    minDy = Math.min(minDy, nr.dy);
  }
}

// sanity: every referenced file exists
let missing = 0;
for (const [k, p] of Object.entries<any>(M.parts)) {
  const refs = p.variants ? Object.values<any>(p.variants).flatMap((v: any) => [v.art, v.mask]).filter(Boolean) : [p.art, p.mask];
  for (const r of refs) if (!existsSync(new URL(r as string, base))) { console.log("MISSING", k, r); missing++; }
}
if (missing) throw new Error(`${missing} missing files`);

writeFileSync(manifestPath, JSON.stringify(M));
console.log(`pass 2 done: ${written.size} parts rewritten, slots stripped, min rect dy = ${minDy} (negative = clipped top)`);
