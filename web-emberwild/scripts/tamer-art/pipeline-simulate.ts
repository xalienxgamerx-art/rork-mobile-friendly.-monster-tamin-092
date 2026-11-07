/**
 * pipeline-simulate.ts — renders what each map-draw resampling mode does to
 * the composed sprite, side by side at 4× inspection zoom:
 *   [ composed 128×192 ]  [ nearest → 65×97 (current runtime) ]  [ area-avg → 65×97 ]
 * `bun scripts/tamer-art/pipeline-simulate.ts` → pipeline_simulate.png
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png";

const B = decodePng(new Uint8Array(readFileSync(new URL("./pipeline_stageB_native.png", import.meta.url))));

const down = (mode: string, w: number, h: number): { w: number; h: number; rgba: Uint8Array } => {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (mode === "nearest") {
        const si = (((y * B.h) / h | 0) * B.w + ((x * B.w) / w | 0)) * 4;
        out.set(B.rgba.slice(si, si + 4), (y * w + x) * 4);
        continue;
      }
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = (x * B.w) / w, x1 = ((x + 1) * B.w) / w, y0 = (y * B.h) / h, y1 = ((y + 1) * B.h) / h;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          if (wx <= 0 || wy <= 0) continue;
          const si = (yy * B.w + xx) * 4, wa = (B.rgba[si + 3] ? 1 : 0) * wx * wy;
          r += B.rgba[si] * wa; g += B.rgba[si + 1] * wa; b += B.rgba[si + 2] * wa; a += wa; n += wx * wy;
        }
      const o = (y * w + x) * 4;
      if (a > n * 0.5) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = 255; }
    }
  return { w, h, rgba: out };
};

const zoom = (img: { w: number; h: number; rgba: Uint8Array }, K: number) => {
  const out = new Uint8Array(img.w * K * img.h * K * 4);
  for (let y = 0; y < img.h * K; y++)
    for (let x = 0; x < img.w * K; x++) {
      const si = (((y / K) | 0) * img.w + ((x / K) | 0)) * 4;
      out.set(img.rgba.slice(si, si + 4), (y * img.w * K + x) * 4);
    }
  return { w: img.w * K, h: img.h * K, rgba: out };
};

const BG = [38, 32, 48, 255];
const W = 65, H = 97, K = 4;
const panels = [zoom(B, K), zoom(down("nearest", W, H), K), zoom(down("area", W, H), K)];
const sheetW = panels.reduce((s, p) => s + p.w + 8, 8), sheetH = Math.max(...panels.map((p) => p.h)) + 8;
const sheet = new Uint8Array(sheetW * sheetH * 4);
for (let i = 0; i < sheetW * sheetH; i++) sheet.set(BG, i * 4);
let X = 8;
for (const p of panels) {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const si = (y * p.w + x) * 4;
      sheet.set(p.rgba[si + 3] ? p.rgba.slice(si, si + 4) : BG, (y * sheetW + X + x) * 4);
    }
  X += p.w + 8;
}
writeFileSync(new URL("./pipeline_simulate.png", import.meta.url), encodePng(sheetW, sheetH, sheet));
console.log(`pipeline_simulate.png: composed ${B.w}x${B.h} | nearest→${W}x${H} (current map draw) | area-avg→${W}x${H} (fix)`);
