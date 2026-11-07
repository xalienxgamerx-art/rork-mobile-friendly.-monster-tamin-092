/** QA grid: 4 looks (columns) x 2 expressions (rows), head crop at 3x, over body. */
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
const compose = (look: any) => {
  const r = composeHD(look, M, getPart);
  if (r.missing.length) throw new Error(r.missing.join("; "));
  return r;
};
const looks = [
  { hair: "hair.crop", face: "face.stern" }, { hair: "hair.tousled", face: "face.easy" },
  { hair: "hair.bob", face: "face.bright" }, { hair: "hair.shag", face: "face.keen" },
];
const exprs = ["neutral", "grin"] as const;
const CX = 384, CY = 210, CR = 110, Z = 3;
const cell = CR * 2 * Z; // 660
const cols = looks.length, rows = exprs.length;
const sheet = new Uint8Array(cell * cols * cell * rows * 4).fill(255);
for (let li = 0; li < cols; li++) {
  for (let ei = 0; ei < rows; ei++) {
    const look = { body: "body.trailwarden", hair: looks[li].hair, face: looks[li].face, expression: exprs[ei] };
    const img = compose(look);
    const x0 = li * cell, y0 = ei * cell;
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const sx = CX - CR + Math.floor(x / Z), sy = CY - CR + Math.floor(y / Z);
        const si = (sy * img.w + sx) * 4, a = img.rgba[si + 3] / 255;
        const di = ((y0 + y) * cell * cols + x0 + x) * 4;
        // composite over white
        sheet[di] = Math.round(img.rgba[si] * a + 255 * (1 - a));
        sheet[di + 1] = Math.round(img.rgba[si + 1] * a + 255 * (1 - a));
        sheet[di + 2] = Math.round(img.rgba[si + 2] * a + 255 * (1 - a));
        sheet[di + 3] = 255;
      }
  }
}
writeFileSync(new URL("zoom_anchor.png", import.meta.url), encodePng(cell * cols, cell * rows, sheet));
console.log("wrote zoom_anchor.png", cell * cols, "x", cell * rows);
