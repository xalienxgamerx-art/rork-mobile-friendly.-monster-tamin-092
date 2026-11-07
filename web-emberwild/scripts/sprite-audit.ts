/**
 * Sprite QA: load every shipped monster/nest PNG, run the runtime cleaner over
 * it, and report which images the cleaner would actually modify (i.e. art that
 * still ships with background black — the sprites that can look "chewed").
 * Run: bun scripts/sprite-audit.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { decodePng, encodePng } from "./sprites";
import { stripBlackBackground } from "../src/game/spritebg";

const dir = "public/monsters/v2";
for (const f of readdirSync(dir).sort()) {
  const img = decodePng(new Uint8Array(readFileSync(`${dir}/${f}`)));
  const d = img.data;
  const n = img.w * img.h;
  let transparent = 0;
  let opaqueBlack = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (d[o + 3] === 0) transparent++;
    else if (Math.max(d[o], d[o + 1], d[o + 2]) <= 36) opaqueBlack++;
  }
  const clean = stripBlackBackground(img);
  let changed = 0;
  for (let i = 0; i < n * 4; i += 4) {
    if (clean.data[i + 3] !== d[i + 3]) changed++;
  }
  const pct = (x: number): string => `${((100 * x) / n).toFixed(1)}%`;
  const flag = changed > 0 ? "  <-- CLEANER WOULD MODIFY" : "";
  console.log(`${f.padEnd(24)} ${img.w}x${img.h}  transparent=${pct(transparent)}  opaqueBlack=${pct(opaqueBlack)}  alphaChangedPx=${changed}${flag}`);
}
