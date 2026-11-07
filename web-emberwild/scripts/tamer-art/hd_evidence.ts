/**
 * hd_evidence.ts — stages A/B/D of the HD evidence sheet: for ONE look
 * (the creator default, generateLook(20260422)), render
 *   A · the raw source artwork for each of its parts (authoritative art)
 *   B · the legacy region-indexed composite (composeLook, 128×192)
 *   D · the HD raw-art composite (composeHD at native 768×1152)
 * `bun scripts/tamer-art/hd_evidence.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  assetFiles,
  composeLook,
  decodePart,
  generateLook,
  resolveLook,
  type PartMap,
} from "../../src/game/appearance";
import { composeHD, type HDManifest, type HDPart, type HDPartData, type HDPartSource } from "../../src/game/tamerLookHDCore";
import { decodePng, encodePng } from "./png";

const look = resolveLook(generateLook(20260422)).look;
console.log("look:", look.body, look.face, look.hair, look.skin, look.hairColor, look.expression);

const blit = (sheet: Uint8Array, W: number, img: { w: number; h: number; rgba: ArrayLike<number> }, X: number, Y: number, scale = 1): void => {
  for (let y = 0; y < img.h * scale; y++)
    for (let x = 0; x < img.w * scale; x++) {
      const si = (Math.floor(y / scale) * img.w + Math.floor(x / scale)) * 4;
      if (img.rgba[si + 3] < 128) continue;
      const px = ((Y + y) * W + X + x) * 4;
      sheet.set([img.rgba[si], img.rgba[si + 1], img.rgba[si + 2], 255], px);
    }
};

// A · raw parts (body / face / hair front — this look's actual parts)
const rawOf = (name: string) => decodePng(new Uint8Array(readFileSync(new URL(`raw/${name}.png`, import.meta.url))));
const hairId = look.hair.replace("hair.", "");
const raws = [rawOf(look.body.replace(".", "_")), rawOf(`${look.face.replace(".", "_")}_${look.expression}`), rawOf(`hair_${hairId}_front`)];
{
  const S = 0.35;
  const AW = Math.round((raws[0].w + raws[2].w) * S) + 36;
  const AH = Math.round(Math.max(raws[0].h, raws[2].h) * S) + 20;
  const sheet = new Uint8Array(AW * AH * 4).fill(0);
  for (let i = 0; i < AW * AH; i++) sheet.set([38, 32, 48, 255], i * 4);
  let X = 16;
  for (const r of raws) {
    blit(sheet, AW, r, X, 10, S);
    X += Math.round(r.w * S) + 14;
  }
  writeFileSync(new URL("./evidence_A_raw.png", import.meta.url), encodePng(AW, AH, sheet));
}

// B · legacy composite (region-indexed), ×2 nearest
const parts = new Map<string, PartMap>();
for (const f of assetFiles()) {
  const png = decodePng(new Uint8Array(readFileSync(new URL(`../../public${f.src}`, import.meta.url))));
  parts.set(f.src, decodePart(png.w, png.h, png.rgba).map);
}
const legacy = composeLook(look, (src) => parts.get(src));
{
  const S = 2;
  const BW = legacy.w * S + 24;
  const BH = legacy.h * S + 24;
  const sheet = new Uint8Array(BW * BH * 4);
  for (let i = 0; i < BW * BH; i++) sheet.set([38, 32, 48, 255], i * 4);
  blit(sheet, BW, { w: legacy.w, h: legacy.h, rgba: legacy.rgba }, 12, 12, S);
  writeFileSync(new URL("./evidence_B_legacy.png", import.meta.url), encodePng(BW, BH, sheet));
}

// D · HD raw-art composite at native 768×1152
const manifest = JSON.parse(readFileSync(new URL("../../public/tamers/hd/manifest.json", import.meta.url), "utf8")) as HDManifest;
const hdCache = new Map<string, HDPartData | undefined>();
const hdPartData = (artPath: string): HDPartData | undefined => {
  const hit = hdCache.get(artPath);
  if (hit !== undefined) return hit;
  const art = decodePng(new Uint8Array(readFileSync(new URL(`../../public/tamers/${artPath}`, import.meta.url))));
  const mask = decodePng(new Uint8Array(readFileSync(new URL(`../../public/tamers/${artPath.replace(/\.png$/, "_mask.png")}`, import.meta.url))));
  const data: HDPartData = { art: { w: art.w, h: art.h, rgba: art.rgba }, mask: decodePart(mask.w, mask.h, mask.rgba).map };
  hdCache.set(artPath, data);
  return data;
};
const getPart: HDPartSource = (part: HDPart, faceId: string): HDPartData | null => {
  const artPath = part.variants ? part.variants[faceId]?.art : part.art;
  return artPath ? (hdPartData(artPath) ?? null) : null;
};
const hd = composeHD(look, manifest, getPart);
if (hd.missing.length) throw new Error(`missing: ${hd.missing.join("; ")}`);
writeFileSync(new URL("./evidence_D_hd.png", import.meta.url), encodePng(hd.w, hd.h, hd.rgba));
console.log("evidence A/B/D written", hd.w, "×", hd.h);
