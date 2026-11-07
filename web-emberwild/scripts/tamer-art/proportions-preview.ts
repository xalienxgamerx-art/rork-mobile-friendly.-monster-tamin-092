/** One-off: compose sample player looks with the fixed HD parts, next to rival_1 for proportion reference. */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png";
import { composeHD, decodeHDMask, type HDManifest, type HDPartData } from "../../src/game/tamerLookHDCore";
import type { TamerLook } from "../../src/game/appearance";

const base = new URL("../../../web-emberwild/public/tamers/", import.meta.url);
const M: HDManifest = JSON.parse(readFileSync(new URL("hd/manifest.json", base), "utf8"));

const parts = new Map<string, HDPartData>();
const getPart = (part: any, faceId: string): HDPartData | null => {
  const p = part.variants ? part.variants[faceId] : part;
  if (!p?.art) return null;
  if (!parts.has(p.art)) {
    const art = decodePng(new Uint8Array(readFileSync(new URL(p.art, base))));
    const m = decodePng(new Uint8Array(readFileSync(new URL(p.mask, base))));
    parts.set(p.art, { art: { w: art.w, h: art.h, rgba: art.rgba }, mask: decodeHDMask(m.w, m.h, m.rgba) });
  }
  return parts.get(p.art) ?? null;
};

const looks: TamerLook[] = [
  { body: "body.wayfarer", face: "face.keen", expression: "neutral", hair: "hair.braid", hairColor: "blond", skin: "tan", eyes: "blue", outfit: { capelet: "red", dress: "navy", belt: "brown", leggings: "indigo", boots: "brown" } },
  { body: "body.trailwarden", face: "face.stern", expression: "grin", hair: "hair.shag", hairColor: "auburn", skin: "deep", eyes: "brown", outfit: { coat: "green", shirt: "cream", belt: "brown", trousers: "brown", boots: "dark" } },
  { body: "body.brawler", face: "face.bright", expression: "neutral", hair: "hair.mane", hairColor: "white", skin: "olive", eyes: "green", outfit: { vest: "teal", wraps: "cream", sash: "red", trousers: "brown", shoes: "dark" } },
] as any[];

const rivals = [decodePng(new Uint8Array(readFileSync(new URL("../../../web-emberwild/public/tamers/rival_1.png", import.meta.url))))];
const composed = looks.map((look) => {
  const r = composeHD(look, M, getPart);
  if (r.missing.length) throw new Error(r.missing.join("; "));
  return { w: r.w, h: r.h, rgba: new Uint8ClampedArray(r.rgba) };
});

const scale = 0.16; // 1152 -> ~184
const W = composed.length * Math.round(768 * scale) + (rivals.length + 1) * 8;
const H = Math.round(1152 * scale) + 16;
const sheet = new Uint8Array(W * H * 4);
let x = 8;
const blit = (im: { w: number; h: number; rgba: ArrayLike<number> }, ox: number, oy: number, dw: number, dh: number): void => {
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(im.h - 1, Math.floor((y * im.h) / dh));
    for (let xx = 0; xx < dw; xx++) {
      const sx = Math.min(im.w - 1, Math.floor((xx * im.w) / dw));
      const o = ((oy + y) * W + ox + xx) * 4;
      const s = (sy * im.w + sx) * 4;
      if (im.rgba[s + 3] < 10) continue;
      sheet[o] = im.rgba[s];
      sheet[o + 1] = im.rgba[s + 1];
      sheet[o + 2] = im.rgba[s + 2];
      sheet[o + 3] = 255;
    }
  }
};
const dw = Math.round(768 * scale), dh = Math.round(1152 * scale);
for (const c of composed) {
  blit(c, x, 8, dw, dh);
  x += dw + 8;
}
for (const r of rivals) blit(r, x, 8, Math.round(r.w * (dh / r.h)), dh);

writeFileSync(new URL("proportions_fixed.png", import.meta.url), encodePng(W, H, sheet));
console.log("wrote proportions_fixed.png");
