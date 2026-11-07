/** Debug: cluster colors of a hair raw to see skin vs hair vs highlights. */
import { readFileSync } from "node:fs";
import { decodePng } from "./png";
import { colorDistance, luma, type Rgb } from "../../src/game/appearance";

const SKIN_KEY: Rgb = [200, 149, 108];
const HAIR_KEY: Rgb = [107, 74, 44];

for (const name of ["hair_tousled_front", "hair_mane_back", "hair_braid_front"]) {
  const png = decodePng(new Uint8Array(readFileSync(new URL(`./raw/${name}.png`, import.meta.url))));
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < png.w * png.h; i++) {
    const o = i * 4;
    if (png.rgba[o + 3] < 100) continue;
    const r = png.rgba[o], g = png.rgba[o + 1], b = png.rgba[o + 2];
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 14);
  console.log(`\n${name} (${png.w}×${png.h}) top colors:`);
  for (const e of sorted) {
    const c: Rgb = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
    console.log(`  rgb(${c.join(",")}) n=${e.n} luma=${luma(c).toFixed(0)} skinDist=${colorDistance(c, SKIN_KEY).toFixed(0)} hairDist=${colorDistance(c, HAIR_KEY).toFixed(0)}`);
  }
}
