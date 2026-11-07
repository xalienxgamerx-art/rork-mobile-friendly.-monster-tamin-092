/**
 * One-off: fix player HD proportions. The segmented head art (face + hair)
 * was placed at ~45% of the sprite height — a bobblehead next to the rival
 * tamers, whose heads are ~1/6 of their height.
 *
 * Fix, entirely in the manifest + resized art (composeHD never stretches):
 *   - body art scaled ×1.12, feet kept on the canvas floor
 *   - face + hair art scaled ×0.75, anchored at the chin so every
 *     hair variant keeps its fit over its face variant
 * Art is resampled bilinear; masks are region-id maps, so nearest-neighbor.
 * New files get a `_p2` suffix and the manifest points at them.
 *
 * Run: bun scripts/tamer-art/fix-proportions.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { decodePng, encodePng } from "./png";

type Rgba = { w: number; h: number; rgba: Uint8Array };

const manifestPath = new URL("../../../web-emberwild/public/tamers/hd/manifest.json", import.meta.url);
// script lives in web-emberwild/scripts/tamer-art
const base = new URL("../../../web-emberwild/public/tamers/", import.meta.url);

const BS = 1.12; // body scale
const S = 0.75; // head scale
const OLD_CHIN = 444; // every face rect: dy 84 + dh 360
const NEW_CHIN = 359; // new body top 292 + 67px neck overlap

const M = JSON.parse(readFileSync(manifestPath, "utf8"));

function resize(src: Rgba, dw: number, dh: number, nearest: boolean): Rgba {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = nearest ? Math.min(src.h - 1, Math.floor(((y + 0.5) * src.h) / dh)) : Math.min(src.h - 1, Math.max(0, (y + 0.5) * (src.h / dh) - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(src.h - 1, y0 + 1);
    const fy = nearest ? 0 : sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = nearest ? Math.min(src.w - 1, Math.floor(((x + 0.5) * src.w) / dw)) : Math.min(src.w - 1, Math.max(0, (x + 0.5) * (src.w / dw) - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(src.w - 1, x0 + 1);
      const fx = nearest ? 0 : sx - x0;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (nearest) {
          out[o + c] = src.rgba[(sy * src.w + sx) * 4 + c];
        } else {
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
const outPath = (p: string): string => p.replace(/\.png$/, "_p2.png");
const emit = (p: string, img: Rgba): string => {
  const np = outPath(p);
  if (!written.has(np)) {
    writeFileSync(new URL(np, base), encodePng(img.w, img.h, img.rgba));
    written.add(np);
  }
  return np;
};

type Rect = { dx: number; dy: number; dw: number; dh: number };

function newRect(kind: "body" | "head", r: Rect): Rect {
  if (kind === "body") {
    const dw = Math.round(r.dw * BS);
    const dh = Math.round(r.dh * BS);
    return { dx: Math.round(384 - dw / 2), dy: 1152 - dh, dw, dh };
  }
  const dw = Math.round(r.dw * S);
  const dh = Math.round(r.dh * S);
  const cx = r.dx + r.dw / 2;
  if (kind === "face") return { dx: Math.round(cx - dw / 2), dy: NEW_CHIN - dh, dw, dh };
  // hair: keep chin-relative reach and own horizontal center
  const bottom = NEW_CHIN + Math.round((r.dy + r.dh - OLD_CHIN) * S);
  return { dx: Math.round(cx - dw / 2), dy: bottom - dh, dw, dh };
}

for (const [key, part] of Object.entries<any>(M.parts)) {
  const kind = key.startsWith("body.") ? "body" : "head";
  if (part.variants) {
    for (const [fid, v] of Object.entries<any>(part.variants)) {
      const nr = newRect(kind, v);
      for (const p of [v.art, v.mask]) {
        const src = load(p);
        if (src.w !== v.dw || src.h !== v.dh) throw new Error(`${p}: ${src.w}x${src.h} ≠ rect ${v.dw}x${v.dh}`);
        const dst = resize(src, nr.dw, nr.dh, p.endsWith("_mask.png"));
        v[p.endsWith("_mask.png") ? "mask" : "art"] = emit(p, dst);
      }
      Object.assign(v, nr);
    }
  } else {
    const nr = newRect(kind, part.rect);
    for (const p of [part.art, part.mask]) {
      const src = load(p);
      if (src.w !== part.rect.dw || src.h !== part.rect.dh) throw new Error(`${p}: ${src.w}x${src.h} ≠ rect ${part.rect.dw}x${part.rect.dh}`);
      const dst = resize(src, nr.dw, nr.dh, p.endsWith("_mask.png"));
      part[p.endsWith("_mask.png") ? "mask" : "art"] = emit(p, dst);
    }
    part.rect = nr;
  }
}

writeFileSync(manifestPath, JSON.stringify(M));
console.log(`wrote ${written.size} files + manifest. body ×${BS}, head ×${S}, chin ${OLD_CHIN}→${NEW_CHIN}`);
