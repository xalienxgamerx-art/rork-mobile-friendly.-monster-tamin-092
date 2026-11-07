/**
 * build-hybrids.ts — process the six crossbreed-only hybrid sprites from
 * scripts/monster-art/raw/ into public/monsters/v2/. The sources are
 * generated with transparency, so the black-background stripper of the main
 * pipeline (scripts/sprites.ts) is not needed: just edge-defringe, trim and
 * box-resize to the same 384 max side as the rest of the roster.
 *
 *   bun scripts/monster-art/build-hybrids.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { trim, resize, decodePng, encodePng, contactSheet } from "../sprites";
import { defringeEdges } from "../../src/game/spritebg";

const RAW = new URL("./raw/", import.meta.url);
const OUT = new URL("../../public/monsters/v2/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const IDS = ["gravewool", "slagtoad", "rimefang", "wispwraith", "geodeback", "mawbrand"];

const outs: ReturnType<typeof decodePng>[] = [];
for (const id of IDS) {
  const src = decodePng(new Uint8Array(readFileSync(new URL(`${id}.png`, RAW))));
  defringeEdges(src);
  const out = resize(trim(src), 384);
  writeFileSync(new URL(`${id}.png`, OUT), encodePng(out));
  outs.push(out);
  console.log(`${id}: ${src.w}×${src.h} → ${out.w}×${out.h}`);
}

writeFileSync(new URL("./qa_hybrids.png", import.meta.url), encodePng(contactSheet(outs)));
console.log("QA sheet scripts/monster-art/qa_hybrids.png written");
