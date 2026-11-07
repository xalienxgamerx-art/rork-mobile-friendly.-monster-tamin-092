/**
 * pipeline-compare.ts — controlled stage comparison for the modular sprite
 * pipeline (diagnosis tool, see scripts/tamer-art/README or the chat log).
 *
 * Stage A: the generated modular part PNGs (public/tamers) for one fixed
 *          look, nearest-neighbor enlarged for inspection.
 * Stage B: the composeLook() output for the same look at native 128×192,
 *          plus a nearest-neighbor enlargement.
 *
 * `bun scripts/tamer-art/pipeline-compare.ts` →
 *   scripts/tamer-art/pipeline_stageA.png / pipeline_stageB.png
 *   + prints structural A→B analysis to stdout.
 *
 * The look matches CreateScreen's default (generateLook(20260422)) so the
 * runtime captures (stage C) show the same character.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png";
import {
  composeLook,
  decodePart,
  defaultLook,
  generateLook,
  type PartMap,
  type TamerLook,
} from "../../src/game/appearance";

const look: TamerLook = { ...generateLook(20260422) };
const parts = new Map<string, PartMap>();
const get = (s: string): PartMap | null => {
  if (!parts.has(s)) {
    const p = decodePng(new Uint8Array(readFileSync(new URL(`../../public${s}`, import.meta.url))));
    parts.set(s, decodePart(p.w, p.h, p.rgba).map);
  }
  return parts.get(s)!;
};

/** nearest-neighbor scale by integer factor K */
const zoom = (w: number, h: number, rgba: Uint8Array, K: number): { w: number; h: number; rgba: Uint8Array } => {
  const out = new Uint8Array(w * K * h * K * 4);
  for (let y = 0; y < h * K; y++)
    for (let x = 0; x < w * K; x++) {
      const si = (((y / K) | 0) * w + ((x / K) | 0)) * 4;
      out.set(rgba.subarray(si, si + 4), (y * w * K + x) * 4);
    }
  return { w: w * K, h: h * K, rgba: out };
};

const BG = [38, 32, 48, 255];
const blit = (sheet: Uint8Array, W: number, img: { w: number; h: number; rgba: Uint8Array }, X: number, Y: number): void => {
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const si = (y * img.w + x) * 4;
      const px = img.rgba[si + 3] ? img.rgba.subarray(si, si + 4) : BG;
      sheet.set(px, ((Y + y) * W + X + x) * 4);
    }
};

const K = 3;

// ── stage A: the four parts of this look ────────────────────────────────────
const used = [
  ["body", look.body, "/body_"],
  ["head", look.head, "/head_"],
  ["face", look.face, "/face_"],
  ["hair", look.hair, "/hair_"],
] as const;
const cells = used.map(([kind, id]) => {
  const src = `/tamers/${id.replace(".", "_")}.png`;
  const p = decodePng(new Uint8Array(readFileSync(new URL(`../../public${src}`, import.meta.url))));
  const big = zoom(p.w, p.h, p.rgba, K);
  return { kind, src, ...big };
});
const AW = cells.reduce((s, c) => s + c.w + 12, 12) + 8 * K;
const AH = Math.max(...cells.map((c) => c.h)) + 12;
const sheetA = new Uint8Array(AW * AH * 4);
for (let i = 0; i < AW * AH; i++) sheetA.set(BG, i * 4);
{
  let X = 12;
  for (const c of cells) {
    blit(sheetA, AW, c, X, 6);
    X += c.w + 12;
  }
}
writeFileSync(new URL("./pipeline_stageA.png", import.meta.url), encodePng(AW, AH, sheetA));
console.log(`stage A: ${cells.map((c) => `${c.kind}=${c.src} (${c.w / K}x${c.h / K})`).join(", ")}`);

// ── stage B: composed output, native + enlarged ─────────────────────────────
const composed = composeLook(look, get);
const B = { w: composed.w, h: composed.h, rgba: new Uint8Array(composed.rgba) };
const Bbig = zoom(B.w, B.h, B.rgba, K);
const BW = Bbig.w + 24, BH = Bbig.h + 12;
const sheetB = new Uint8Array(BW * BH * 4);
for (let i = 0; i < BW * BH; i++) sheetB.set(BG, i * 4);
blit(sheetB, BW, Bbig, 12, 6);
writeFileSync(new URL("./pipeline_stageB.png", import.meta.url), encodePng(BW, BH, sheetB));

// native-resolution copy for pixel comparisons (no enlargement)
writeFileSync(new URL("./pipeline_stageB_native.png", import.meta.url), encodePng(B.w, B.h, B.rgba));

// ── A→B analysis: does composition itself lose anything? ────────────────────
// Every composed opaque pixel must be the exact ramp color of some part
// pixel's (slot, shade); every part silhouette pixel must stay opaque.
const colorSet = new Set<string>();
let opaque = 0;
for (let i = 0; i < B.w * B.h; i++)
  if (B.rgba[i * 4 + 3]) {
    opaque++;
    colorSet.add(`${B.rgba[i * 4]},${B.rgba[i * 4 + 1]},${B.rgba[i * 4 + 2]}`);
  }
console.log(`stage B: composed ${B.w}x${B.h}, ${opaque} opaque px, distinct colors: ${colorSet.size}`);
console.log(`look: ${JSON.stringify(look)}`);
console.log(`defaultLook id mismatch check: ${JSON.stringify(defaultLook()) === JSON.stringify(look) ? "is default" : "creator default"}`);
