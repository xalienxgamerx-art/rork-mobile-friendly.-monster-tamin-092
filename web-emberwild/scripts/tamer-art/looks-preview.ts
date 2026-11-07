/** Render 4 labeled looks large, one per row, with hair variants. */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png";
import { composeHD, decodeHDMask, type HDManifest, type HDPartData } from "../../src/game/tamerLookHDCore";

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
const looks: any[] = [
  { label: "wayfarer", body: "body.wayfarer", face: "face.easy", expression: "grin", hair: "hair.braid", hairColor: "blond", skin: "tan", eyes: "blue" },
  { label: "trailwarden", body: "body.trailwarden", face: "face.stern", expression: "neutral", hair: "hair.crop", hairColor: "brown", skin: "deep", eyes: "brown" },
  { label: "brawler", body: "body.brawler", face: "face.bright", expression: "grin", hair: "hair.tousled", hairColor: "black", skin: "olive", eyes: "green" },
  { label: "scout", body: "body.scout", face: "face.keen", expression: "neutral", hair: "hair.mane", hairColor: "auburn", skin: "tan", eyes: "blue" },
];
const scale = 0.42;
const dw = Math.round(768 * scale), dh = Math.round(1152 * scale);
const W = (dw + 16) * 4, H = dh + 16;
const sheet = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; sheet[o] = 34; sheet[o + 1] = 31; sheet[o + 2] = 30; sheet[o + 3] = 255; }
looks.forEach((look, i) => {
  const r = composeHD(look, M, getPart);
  if (r.missing.length) throw new Error(look.label + ": " + r.missing.join("; "));
  const ox = 8 + i * (dw + 16), oy = 8;
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const sx = Math.floor(x / scale), sy = Math.floor(y / scale);
      const s = (sy * r.w + sx) * 4, d = ((oy + y) * W + ox + x) * 4;
      if (r.rgba[s + 3] < 10) continue;
      sheet[d] = r.rgba[s]; sheet[d + 1] = r.rgba[s + 1]; sheet[d + 2] = r.rgba[s + 2]; sheet[d + 3] = 255;
    }
});
writeFileSync(new URL("segment_looks.png", import.meta.url), encodePng(W, H, sheet));
console.log("wrote segment_looks.png");
