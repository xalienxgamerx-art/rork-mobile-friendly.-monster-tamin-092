/** Diff: does the composed sprite lose any front-hair art pixels? */
import { decodePng } from "./png.ts";
import { readFileSync } from "node:fs";
import { composeHD, type HDManifest, type HDPartData } from "../../src/game/tamerLookHDCore.ts";
import { generateLook } from "../../src/game/appearance.ts";

const M: HDManifest = JSON.parse(readFileSync("public/tamers/hd/manifest.json", "utf8"));
const cache = new Map<string, HDPartData>();
const load = (name: string) => {
  if (!cache.has(name)) {
    const png = decodePng(new Uint8Array(readFileSync(`public/tamers/${name}`)));
    let map: HDPartData["mask"] | null = null;
    try {
      const m = decodePng(new Uint8Array(readFileSync(`public/tamers/${name.replace(".png", "_mask.png")}`)));
      const s = m.rgba;
      const slot = new Uint8Array(m.width * m.height), shade = new Uint8Array(m.width * m.height);
      for (let i = 0; i < slot.length; i++) { slot[i] = s[i*4]; shade[i] = s[i*4+1]; }
      map = { w: m.width, h: m.height, slot, shade } as never;
    } catch { /* faces have no mask */ }
    cache.set(name, { art: { w: png.w, h: png.h, rgba: png.rgba }, mask: map! });
  }
  return cache.get(name)!;
};

const look = generateLook(20260422);
// debug
console.log("look:", look.body, look.face, look.hair);
const composed = composeHD(look, M, (part) => {
  if (part.variants) {
    const v = part.variants[look.face.replace("face.", "")];
    return load(v.art);
  }
  return load(part.art!);
});

console.log("missing parts:", composed.missing);
const hairId = look.hair.replace("hair.", "");
const faceId = look.face.replace("face.", "");
const front = M.parts[`hair.${hairId}.front`];
const v = front.variants![faceId];
const art = load(v.art).art;
let lost = 0, examples: string[] = [];
for (let y = 0; y < v.dh; y++) {
  for (let x = 0; x < v.dw; x++) {
    const si = (y * art.w + x) * 4;
    if (art.rgba[si + 3] < 128) continue;
    const cx = v.dx + x, cy = v.dy + y;
    const o = (cy * composed.w + cx) * 4;
    if (composed.rgba[o + 3] === 0) {
      lost++;
      if (examples.length < 10) examples.push(`art(${x},${y}) -> canvas(${cx},${cy})`);
    }
  }
}
console.log(`front hair ${v.art}: lost opaque pixels: ${lost}`);
console.log(examples.join("\n"));
// also check: pixels where composed has content but owner is NOT front hair within rect
const own = composed.owner;
let hijacked = new Map<string, number>();
for (let y = 0; y < v.dh; y++) for (let x = 0; x < v.dw; x++) {
  const si = (y * art.w + x) * 4;
  if (art.rgba[si + 3] < 128) continue;
  const cx = v.dx + x, cy = v.dy + y;
  const oKey = own[cy * composed.w + cx];
  if (oKey !== `hair.${hairId}.front`) hijacked.set(oKey, (hijacked.get(oKey) ?? 0) + 1);
}
console.log("owner mismatch within front-hair art footprint:", JSON.stringify([...hijacked.entries()]));
