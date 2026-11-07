/** What draws the dark line across the neck at canvas y≈280-300? */
import { decodePng } from "./png.ts";
import { readFileSync } from "node:fs";
import { composeHD, type HDManifest, type HDPartData } from "../../src/game/tamerLookHDCore.ts";
import { generateLook } from "../../src/game/appearance.ts";

const M: HDManifest = JSON.parse(readFileSync("public/tamers/hd/manifest.json", "utf8"));
const cache = new Map<string, HDPartData>();
const load = (name: string): HDPartData => {
  if (!cache.has(name)) {
    const png = decodePng(new Uint8Array(readFileSync(`public/tamers/${name}`)));
    let mask: HDPartData["mask"] | undefined;
    try {
      const m = decodePng(new Uint8Array(readFileSync(`public/tamers/${name.replace(".png", "_mask.png")}`)));
      const slot = new Uint8Array(m.w * m.h), shade = new Uint8Array(m.w * m.h);
      for (let i = 0; i < slot.length; i++) { slot[i] = m.rgba[i*4]; shade[i] = m.rgba[i*4+1]; }
      mask = { w: m.w, h: m.h, slot, shade } as never;
    } catch { /* face parts have no mask */ }
    cache.set(name, { art: { w: png.w, h: png.h, rgba: png.rgba }, mask: mask! });
  }
  return cache.get(name)!;
};

const look = generateLook(20260422);
const composed = composeHD(look, M, (part) =>
  part.variants ? load(part.variants[look.face.replace("face.", "")].art) : load(part.art!));

for (let y = 270; y <= 305; y++) {
  let row = "";
  for (let x = 355; x <= 415; x++) {
    const o = (y * composed.w + x) * 4;
    const dark = composed.rgba[o] < 110 && composed.rgba[o+1] < 80 && composed.rgba[o+2] < 80;
    row += dark ? "#" : (composed.rgba[o + 3] ? "." : " ");
  }
  const owners = new Set<string>();
  for (let x = 355; x <= 415; x++) {
    const o = (y * composed.w + x) * 4;
    const dark = composed.rgba[o] < 110 && composed.rgba[o+1] < 80 && composed.rgba[o+2] < 80;
    if (dark) owners.add(composed.owner[y * composed.w + x]);
  }
  console.log(y, row, [...owners].join(","));
}
