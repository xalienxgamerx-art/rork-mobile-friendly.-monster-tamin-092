/**
 * Tree sprite keying — turns the generated magenta-background tree art into
 * transparent RGBA PNGs for public/trees.
 *
 * The image generator cannot emit alpha, so the trees are requested on a flat
 * solid #FF00FF backdrop and keyed here:
 *   1. flood fill from the borders through magenta-ish pixels (a hue test, not
 *      an exact color match — generators never hit the exact value everywhere)
 *   2. despill the silhouette edge: half-magenta fringe pixels are pulled
 *      toward their own green channel so no pink rim survives
 *   3. feather the edge one step (alpha gradient) so the sprite sits softly
 *   4. encode a real RGBA PNG (filters off, zlib via bun)
 *
 * Usage: bun scripts/trees/key-trees.ts <in.png> <out.png> [--max-h 768]
 * Raw RGBA is read through ffmpeg (a decoder we don't have to trust our own
 * PNG parsing to): ffmpeg -i in.png -f rawvideo -pix_fmt rgba.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { deflateSync } from "node:zlib";

const [src, dst] = process.argv.slice(2);
const maxHIdx = process.argv.indexOf("--max-h");
const maxH = maxHIdx >= 0 ? Number(process.argv[maxHIdx + 1]) : 0;
if (!src || !dst) {
  console.error("usage: bun scripts/trees/key-trees.ts <in.png> <out.png> [--max-h 768]");
  process.exit(1);
}

// --- decode (ffmpeg → raw RGBA; downscale first when --max-h is given) ---
const raw = execSync(
  maxH
    ? `ffmpeg -y -loglevel error -i "${src}" -vf "scale=-2:${maxH}:flags=area" -f rawvideo -pix_fmt rgba -`
    : `ffmpeg -y -loglevel error -i "${src}" -f rawvideo -pix_fmt rgba -`,
  { maxBuffer: 1 << 28 },
);
// dimensions from the source PNG's IHDR; --max-h scales with aspect kept
const png = readFileSync(src);
const sw = png.readUInt32BE(16);
const sh = png.readUInt32BE(20);
const w = maxH ? Math.round((sw * maxH) / sh) : sw;
const h = maxH || sh;
if (raw.length !== w * h * 4) {
  console.error(`decode size mismatch: got ${raw.length} bytes, expected ${w}x${h}x4`);
  process.exit(1);
}
const img = new Uint8Array(raw);

// --- magenta-ish test: red and blue both strong, green far behind ---
const magentaish = (i: number): boolean => {
  const r = img[i];
  const g = img[i + 1];
  const b = img[i + 2];
  const mn = Math.min(r, b);
  return mn > 90 && g < mn * 0.72 - 12;
};

// --- 1. flood fill the background from every border pixel ---
const key = new Uint8Array(w * h);
const stack: number[] = [];
const push = (x: number, y: number): void => {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const p = y * w + x;
  if (key[p]) return;
  if (!magentaish(p * 4)) return;
  key[p] = 1;
  stack.push(p);
};
for (let x = 0; x < w; x++) {
  push(x, 0);
  push(x, h - 1);
}
for (let y = 0; y < h; y++) {
  push(0, y);
  push(w - 1, y);
}
while (stack.length) {
  const p = stack.pop() as number;
  const x = p % w;
  const y = (p / w) | 0;
  push(x + 1, y);
  push(x - 1, y);
  push(x, y + 1);
  push(x, y - 1);
}
let keyed = 0;
for (let p = 0; p < w * h; p++) {
  // the border flood fill gets the outside; any remaining magenta-ish pixel is
  // an enclosed pocket (a gap between branches showing the backdrop through)
  // — the art itself holds no magenta, so a global sweep is safe here
  if (key[p] || magentaish(p * 4)) {
    img[p * 4 + 3] = 0;
    keyed++;
  }
}
console.log(`${dst}: keyed ${(100 * (keyed / (w * h))).toFixed(1)}% of ${w}x${h}`);

// --- 2. despill the fringe: any kept pixel touching transparency with magenta
// residue gets pulled toward its green channel and softened ---
const copy = img.slice();
const despill = (i: number, strength: number): void => {
  const g = copy[i + 1];
  copy[i] = Math.round(copy[i] * (1 - strength) + g * strength);
  copy[i + 2] = Math.round(copy[i + 2] * (1 - strength) + g * strength);
};
const nearClear = (x: number, y: number): number => {
  let clear = 0;
  let tot = 0;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    tot++;
    if (copy[(ny * w + nx) * 4 + 3] === 0) clear++;
  }
  return tot ? clear / tot : 0;
};
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (copy[p * 4 + 3] === 0) continue;
    const adj = nearClear(x, y);
    if (!adj) continue;
    const i = p * 4;
    const mn = Math.min(copy[i], copy[i + 2]);
    const g = copy[i + 1];
    const spill = mn > 40 ? Math.max(0, Math.min(1, (mn * 0.72 - 12 - g) / 60)) : 0;
    if (spill > 0) despill(i, Math.min(0.85, spill * adj));
    if (adj === 1) copy[i + 3] = Math.round(copy[i + 3] * 0.6);
  }
}
img.set(copy);

// --- 3. encode RGBA PNG (filter 0 rows, zlib) ---
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0);
ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const stride = w * 4;
const filtered = Buffer.alloc((stride + 1) * h);
for (let y = 0; y < h; y++) {
  filtered[y * (stride + 1)] = 0;
  Buffer.from(img.buffer, y * stride, stride).copy(filtered, y * (stride + 1) + 1);
}
const out = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(filtered, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(dst, out);
console.log(`${dst}: written, ${keyed === 0 ? "WARNING nothing keyed" : "ok"}`);
