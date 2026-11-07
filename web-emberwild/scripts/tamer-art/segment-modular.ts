/**
 * Pass 3 — restructure the modular tamer parts to the 3-sprite system:
 *
 *   body   = body + clothing + head (bald skin head, no face features)
 *   face   = expression only: eyes, brows, mouth — no head, no background
 *   hair   = unchanged
 *
 * The head is baked from the canonical face art (face.easy.neutral): its
 * skin-mask region, tone-matched to each body's own skin key so head and
 * hands agree. Face art keeps only its feature pixels (mask slots
 * eyes/brow/mouth), so any face drops onto any head in register.
 *
 * New files: hd/<part>_p4.png (+ `_p4_mask.png`, the loader's derived mask
 * name). Bodies become full-canvas 768×1152. Run:
 *   bun scripts/tamer-art/segment-modular.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { decodePng, encodePng } from "./png";
import { transferColor, type Rgb } from "../../src/game/tamerLookHDCore";

type Rgba = { w: number; h: number; rgba: Uint8Array };

const base = new URL("../../../web-emberwild/public/tamers/", import.meta.url);
const manifestPath = new URL("../../../web-emberwild/public/tamers/hd/manifest.json", import.meta.url);

const M = JSON.parse(readFileSync(manifestPath, "utf8"));

// mask → slot id (decodePart encoding: slot = R >> 4 on valid pixels)
const slotAt = (d: Uint8Array, i: number): number =>
  d[i * 4 + 3] < 128 || d[i * 4 + 2] < 64 || d[i * 4 + 2] > 192 ? 255 : d[i * 4] >> 4;
const SKIN = 1, EYES = 3, MOUTH = 5, BROW = 6;

const hex = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
// body skin keys from the original segmentation manifest
const BODY_SKIN: Record<string, string> = {
  "body.trailwarden": "#cba988",
  "body.brawler": "#e69a62",
  "body.wayfarer": "#cfac87",
  "body.scout": "#d4a37b",
};
const CANON_FACE = "face.easy.neutral";
const FACE_SKIN = hex("#eab076");

const load = (p: string): Rgba => decodePng(new Uint8Array(readFileSync(new URL(p, base))));
const write = (p: string, img: Rgba): void => writeFileSync(new URL(p, base), encodePng(img.w, img.h, img.rgba));
const W = M.w as number, H = M.h as number;

// ── canonical head skin, extracted once ─────────────────────────────────────
const canon = M.parts[CANON_FACE];
const canonArt = load(canon.art);
const canonMask = load(canon.mask);
const { dx: fdx, dy: fdy, dw: fdw, dh: fdh } = canon.rect;
// head skin recolored to an arbitrary target skin key, full-canvas placement
function headSkin(target: Rgb): { canvas: Rgba; at: Rect } {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < fdh; y++) {
    for (let x = 0; x < fdw; x++) {
      const i = y * fdw + x;
      if (slotAt(canonMask.rgba, i) !== SKIN) continue;
      const o = i * 4;
      if (canonArt.rgba[o + 3] === 0) continue;
      const px: Rgb = [canonArt.rgba[o], canonArt.rgba[o + 1], canonArt.rgba[o + 2]];
      const rc = transferColor(px, FACE_SKIN, target);
      const oo = ((y + fdy) * W + (x + fdx)) * 4;
      out[oo] = rc[0]; out[oo + 1] = rc[1]; out[oo + 2] = rc[2]; out[oo + 3] = canonArt.rgba[o + 3];
    }
  }
  return { canvas: { w: W, h: H, rgba: out }, at: { dx: fdx, dy: fdy, dw: fdw, dh: fdh } };
}

type Rect = { dx: number; dy: number; dw: number; dh: number };
const blank = (w: number, h: number): Rgba => ({ w, h, rgba: new Uint8Array(w * h * 4) });

// ── faces: features only ────────────────────────────────────────────────────
for (const [key, part] of Object.entries<any>(M.parts)) {
  if (!key.startsWith("face.")) continue;
  const art = load(part.art);
  const mask = load(part.mask);
  const out = new Uint8Array(art.w * art.h * 4);
  for (let i = 0; i < art.w * art.h; i++) {
    const s = slotAt(mask.rgba, i);
    if (s !== EYES && s !== BROW && s !== MOUTH) continue;
    const o = i * 4;
    out[o] = art.rgba[o]; out[o + 1] = art.rgba[o + 1]; out[o + 2] = art.rgba[o + 2]; out[o + 3] = art.rgba[o + 3];
  }
  const name = key.replaceAll(".", "_") + "_p4";
  write(`hd/${name}.png`, { w: art.w, h: art.h, rgba: out });
  write(`hd/${name}_mask.png`, blank(art.w, art.h));
  part.art = `hd/${name}.png`;
  part.mask = `hd/${name}_mask.png`;
}

// ── bodies: body + clothing + baked bald head ───────────────────────────────
for (const [key, part] of Object.entries<any>(M.parts)) {
  if (!key.startsWith("body.")) continue;
  const skinKey = hex(BODY_SKIN[key]);
  const head = headSkin(skinKey);
  const body = load(part.art);
  const out = new Uint8Array(W * H * 4);
  // body at its rect
  const { dx: bdx, dy: bdy, dw: bdw, dh: bdh } = part.rect;
  for (let y = 0; y < bdh; y++)
    for (let x = 0; x < bdw; x++) {
      const o = (y * bdw + x) * 4;
      if (body.rgba[o + 3] === 0) continue;
      const oo = ((y + bdy) * W + (x + bdx)) * 4;
      out[oo] = body.rgba[o]; out[oo + 1] = body.rgba[o + 1]; out[oo + 2] = body.rgba[o + 2]; out[oo + 3] = body.rgba[o + 3];
    }
  // head on top (covers the body's neck stub)
  const ha = head.canvas.rgba;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (ha[o + 3] === 0) continue;
    out[o] = ha[o]; out[o + 1] = ha[o + 1]; out[o + 2] = ha[o + 2]; out[o + 3] = ha[o + 3];
  }
  const id = key.replace("body.", "");
  write(`hd/body_${id}_p4.png`, { w: W, h: H, rgba: out });
  write(`hd/body_${id}_p4_mask.png`, blank(W, H));
  part.art = `hd/body_${id}_p4.png`;
  part.mask = `hd/body_${id}_p4_mask.png`;
  part.rect = { dx: 0, dy: 0, dw: W, dh: H };
}

// ── sanity + save ───────────────────────────────────────────────────────────
let missing = 0;
for (const [k, p] of Object.entries<any>(M.parts)) {
  const refs = p.variants ? Object.values<any>(p.variants).flatMap((v: any) => [v.art, v.mask]).filter(Boolean) : [p.art, p.mask];
  for (const r of refs) if (!existsSync(new URL(r as string, base))) { console.log("MISSING", k, r); missing++; }
}
if (missing) throw new Error(`${missing} missing files`);
writeFileSync(manifestPath, JSON.stringify(M));
console.log("pass 3 done: bodies are body+clothing+head, faces are features-only, hair untouched");
