/** Contact sheet of p7 face raws on a checkerboard, 4x2 grid. */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png";
const gen = new URL("raw/gen/", import.meta.url);
const names = ["stern_neutral","stern_grin","easy_neutral","easy_grin","bright_neutral","bright_grin","keen_neutral","keen_grin"];
const cell = 512, cols = 4, rows = 2;
const sheet = new Uint8Array(cell * cols * cell * rows * 4);
for (let i = 0; i < sheet.length; i += 4) {
  const x = (i / 4) % (cell * cols), y = Math.floor(i / 4 / (cell * cols));
  const v = ((x >> 5) + (y >> 5)) % 2 ? 200 : 160;
  sheet[i] = v; sheet[i + 1] = v; sheet[i + 2] = v; sheet[i + 3] = 255;
}
for (let k = 0; k < 8; k++) {
  const img = decodePng(new Uint8Array(readFileSync(new URL(`p7_face_${names[k]}.png`, gen))));
  const s = Math.min(cell / img.w, cell / img.h);
  const dw = Math.round(img.w * s), dh = Math.round(img.h * s);
  const cx = (k % cols) * cell + (cell - dw) / 2 >> 0, cy = Math.floor(k / cols) * cell + (cell - dh) / 2;
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const si = (Math.floor(y / s) * img.w + Math.floor(x / s)) * 4;
      if (img.rgba[si + 3] < 40) continue;
      const di = ((cy + y) * cell * cols + cx + x) * 4;
      sheet[di] = img.rgba[si]; sheet[di + 1] = img.rgba[si + 1]; sheet[di + 2] = img.rgba[si + 2]; sheet[di + 3] = 255;
    }
}
writeFileSync(new URL("contact_p7.png", import.meta.url), encodePng(cell * cols, cell * rows, sheet));
console.log("wrote contact_p7.png");
