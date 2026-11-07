/** Debug: compose a look from the HD manifest and save head close-ups. */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png";
import { generateLook } from "../../src/game/appearance";
import { composeHD, type HDManifest, type HDPartData } from "../../src/game/tamerLookHDCore";

const manifest: HDManifest = JSON.parse(readFileSync(new URL("../../public/tamers/hd/manifest.json", import.meta.url), "utf8"));
const cache = new Map<string, HDPartData>();
const load = (src: string): HDPartData | null => {
  const hit = cache.get(src);
  if (hit) return hit;
  const art = decodePng(new Uint8Array(readFileSync(new URL(`../../public/tamers/${src}`, import.meta.url))));
  const m = decodePng(new Uint8Array(readFileSync(new URL(`../../public/tamers/${src.slice(0, -4)}_mask.png`, import.meta.url))));
  const d = { art: { w: art.w, h: art.h, rgba: art.rgba }, mask: { w: m.w, h: m.h, slot: new Uint8Array(m.w * m.h), shade: new Uint8Array(m.w * m.h) } };
  for (let i = 0; i < m.w * m.h; i++) {
    if (m.rgba[i * 4 + 3] < 128) continue;
    d.mask.slot[i] = m.rgba[i * 4] >> 4;
    d.mask.shade[i] = m.rgba[i * 4 + 1] >> 5;
  }
  cache.set(src, d);
  return d;
};
for (const seed of [512, 1701]) {
  const c = composeHD(generateLook(seed), manifest, (part, faceId) => {
    const v = part.variants?.[faceId];
    return load(v ? v.art : part.art!);
  });
  const X = 172, Y = 40, W2 = 440, H2 = 500, SC = 2;
  const out = new Uint8Array(W2 * SC * H2 * SC * 4);
  for (let y = 0; y < H2 * SC; y++)
    for (let x = 0; x < W2 * SC; x++) {
      const sx = X + ((x / SC) | 0), sy = Y + ((y / SC) | 0);
      const si = (sy * c.w + sx) * 4;
      if (!c.rgba[si + 3]) continue;
      out.set([c.rgba[si], c.rgba[si + 1], c.rgba[si + 2], 255], (y * W2 * SC + x) * 4);
    }
  writeFileSync(new URL(`./hd_zoom_${seed}.png`, import.meta.url), Buffer.from(encodePng(W2 * SC, H2 * SC, out)));
}
console.log("done");
