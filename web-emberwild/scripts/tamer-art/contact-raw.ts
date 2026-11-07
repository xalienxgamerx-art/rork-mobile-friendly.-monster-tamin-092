/** Contact sheet of the freshly generated raw assets, on a checker to reveal alpha. */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { decodePng, encodePng } from "./png";

const dir = new URL("./raw/gen/", import.meta.url);
const names = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
const cell = 240, pad = 8;
const cols = 4, rows = Math.ceil(names.length / cols);
const W = cols * (cell + pad) + pad, H = rows * (cell + pad) + pad;
const sheet = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const c = ((x >> 4) + (y >> 4)) & 1 ? 235 : 200;
    sheet[o] = sheet[o + 1] = sheet[o + 2] = c; sheet[o + 3] = 255;
  }
names.forEach((f, i) => {
  const img = decodePng(new Uint8Array(readFileSync(new URL(f, dir))));
  const s = Math.min(cell / img.w, cell / img.h);
  const dw = Math.round(img.w * s), dh = Math.round(img.h * s);
  const ox = pad + (i % cols) * (cell + pad), oy = pad + Math.floor(i / cols) * (cell + pad);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const sx = Math.floor(x / s), sy = Math.floor(y / s);
      const sp = (sy * img.w + sx) * 4, dp = ((oy + y) * W + ox + x) * 4;
      const a = img.rgba[sp + 3] / 255;
      if (a < 0.02) continue;
      for (let k = 0; k < 3; k++) sheet[dp + k] = Math.round(img.rgba[sp + k] * a + sheet[dp + k] * (1 - a));
    }
});
writeFileSync(new URL("contact_raw.png", import.meta.url), encodePng(W, H, sheet));
console.log(names.join("\n"));
