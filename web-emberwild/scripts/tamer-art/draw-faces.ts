/**
 * Draw the 8 face sprites procedurally via the expression rig (faceRig.ts).
 *
 * Faces are features-only (transparent bg, no head/hair — the hair layers own
 * the ears). Each tamer personality maps to a face STYLE; the neutral/grin
 * expressions are rig presets blended per personality.
 *
 * Outputs  hd/face_<f>_<e>_p11.png (+ blank _p11_mask.png) on the shared face
 *          rect (canvas center (120,110) == head (384,206)).
 *
 * Run AFTER assemble-sprites.ts (it owns bodies/hair + head metrics).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { encodePng } from "./png";
import {
  DEFAULT_PALETTE, EXPR, drawFace, mixStates,
  type FaceLayout, type FacePalette, type FaceState, type FaceStyle,
} from "../../src/game/faceRig";

const base = new URL("../../../web-emberwild/public/tamers/", import.meta.url);

const FW = 240, FH = 220;
// head geometry (measured by assemble-sprites.ts, stable across bodies)
const HEAD_TOP = 136, HEAD_H = 127.75, HEAD_W = 132.7, CX = 384;
// face-rect placement used by the manifest (center = head center at 55% head height)
const RECT = { dx: CX - FW / 2, dy: Math.round(HEAD_TOP + 0.55 * HEAD_H) - FH / 2, dw: FW, dh: FH };

// rig grid: 60×55 cells at scale 4 → exactly 240×220.
// Feature rows measured against the real body head (canvas y): skull top 137,
// bangs end ~190, chin/jaw bottom 289 → head-relative: eyes 0.42, nose 0.62,
// mouth 0.78 (the old rows put the mouth at 0.65 with a huge empty chin).
const P = 4;
const LAYOUT: FaceLayout = {
  width: FW / P, height: FH / P, cx: FW / (2 * P), // 60, 55, 30
  eyeY: 27, eyeDX: 7, eyeW: 8, eyeH: 5,
  browY: 20, browW: 10, browThick: 2,
  noseY: 34, mouthY: 40, mouthW: 10, mouthH: 8,
};

// game-matched palette (body head skin is flat #FDB473)
const PALETTE: FacePalette = {
  ...DEFAULT_PALETTE,
  outline: "#0d0a06", sclera: "#f8f4ec",
  iris: "#5d3a20", irisLight: "#7d5030", pupil: "#2e1a0e",
  brow: "#4a2c15", mouthIn: "#4a2018", teeth: "#f6f0e2",
  lip: "#b06a4a", shade: "#e8975a", skinHi: "#f0b882",
  blush: "#f0906a", lidLow: "#e0986a", crease: "#c07a4a",
};

// personality → face style (closed-stroke mouths use lipless shapes — the
// standard style's lip row renders one cell below the stroke and reads as a
// second mouth at sprite scale)
const STYLES: Record<string, FaceStyle> = {
  stern: { eye: "narrow", brow: "thick", nose: "standard", mouth: "thin", details: [] },
  easy: { eye: "almond", brow: "arched", nose: "standard", mouth: "thin", details: [] },
  bright: { eye: "sprite", brow: "thin", nose: "button", mouth: "full", details: [] },
  keen: { eye: "sharp", brow: "angular", nose: "standard", mouth: "cat", details: [] },
};

// personality → expression states (neutral, grin)
const EXPR_FOR: Record<string, [FaceState, FaceState]> = {
  stern: [
    mixStates(EXPR.neutral, EXPR.angry, 0.45),
    mixStates(mixStates(EXPR.neutral, EXPR.angry, 0.45), EXPR.joy, 0.5),
  ],
  easy: [
    mixStates(EXPR.neutral, EXPR.happy, 0.25),
    EXPR.happy,
  ],
  bright: [
    mixStates(EXPR.neutral, EXPR.happy, 0.35),
    EXPR.joy,
  ],
  keen: [
    EXPR.smug,
    mixStates(EXPR.smug, EXPR.joy, 0.6),
  ],
};

const FACES = ["stern", "easy", "bright", "keen"] as const;
const EXPRS = ["neutral", "grin"] as const;

const writePng = (p: string, w: number, h: number, rgba: Uint8Array) =>
  writeFileSync(new URL(p, base), encodePng(w, h, rgba));

const blank = () => new Uint8Array(FW * FH * 4);

function upscale(buf: { width: number; height: number; data: Uint8ClampedArray }): Uint8Array {
  const out = new Uint8Array(FW * FH * 4);
  for (let y = 0; y < buf.height; y++)
    for (let x = 0; x < buf.width; x++) {
      const si = (y * buf.width + x) * 4;
      if (buf.data[si + 3] === 0) continue;
      for (let py = 0; py < P; py++)
        for (let px = 0; px < P; px++) {
          const o = ((y * P + py) * FW + x * P + px) * 4;
          out[o] = buf.data[si]; out[o + 1] = buf.data[si + 1]; out[o + 2] = buf.data[si + 2]; out[o + 3] = 255;
        }
    }
  return out;
}

for (const f of FACES)
  for (const e of EXPRS) {
    const state = EXPR_FOR[f][e === "grin" ? 1 : 0];
    const buf = drawFace(state, LAYOUT, PALETTE, STYLES[f]);
    writePng(`hd/face_${f}_${e}_p11.png`, FW, FH, upscale(buf));
    writePng(`hd/face_${f}_${e}_p11_mask.png`, FW, FH, blank());
    console.log(`face_${f}_${e}_p11: drawn`);
  }

const manifestPath = new URL("hd/manifest.json", base);
const M = JSON.parse(readFileSync(manifestPath, "utf8"));
M.version = (M.version ?? 1) + 1;
for (const f of FACES)
  for (const e of EXPRS) {
    const p = M.parts[`face.${f}.${e}`];
    p.art = `hd/face_${f}_${e}_p11.png`;
    p.mask = `hd/face_${f}_${e}_p11_mask.png`;
    p.rect = { ...RECT };
  }
writeFileSync(manifestPath, JSON.stringify(M, null, "\t") + "\n");
console.log(`manifest updated, version ${M.version}`);
