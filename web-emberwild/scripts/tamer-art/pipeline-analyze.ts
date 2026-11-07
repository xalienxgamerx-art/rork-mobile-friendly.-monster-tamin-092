/**
 * pipeline-analyze.ts — measures where the composed sprite's detail dies.
 *
 * 1. Creator: stage C creator capture (device px) vs stage B nearest-2×.
 *    NCC of luma is used because page overlays blend a tint over the canvas:
 *    NCC is invariant to affine brightness changes; 1.0 = same image.
 * 2. Map: locates the player by template matching (NCC over a search
 *    window around screen center), then scores the runtime pixels against
 *    two simulated downscales of stage B at the same device size:
 *      - nearest (what smoothing-off does at a non-integer ratio)
 *      - area-average (box filter)
 *    Reports luma NCC and dark-ink (outline) survival for each.
 */
import { readFileSync } from "node:fs";
import { decodePng } from "./png";

const load = (p: string) => decodePng(new Uint8Array(readFileSync(new URL(p, import.meta.url))));
const B = load("./pipeline_stageB_native.png");
const creator = load("./pipeline_stageC_creator.png");
const map = load("./pipeline_stageC_map.png");

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** normalized cross-correlation of two sample clouds (tint-invariant) */
const ncc = (samples: [number, number][]): number => {
  let sa = 0, sb = 0, n = 0;
  for (const [a, b] of samples) { sa += a; sb += b; n++; }
  if (n < 2) return 0;
  const ma = sa / n, mb = sb / n;
  let ab = 0, aa = 0, bb = 0;
  for (const [a, b] of samples) { ab += (a - ma) * (b - mb); aa += (a - ma) ** 2; bb += (b - mb) ** 2; }
  return ab / Math.sqrt(Math.max(1e-9, aa * bb));
};

// ── 1. creator ──────────────────────────────────────────────────────────────
{
  const samples: [number, number][] = [];
  let sum = 0, n = 0;
  for (let y = 0; y < Math.min(creator.h, B.h * 2); y++)
    for (let x = 0; x < creator.w; x++) {
      const si = ((y / 2 | 0) * B.w + (x / 2 | 0)) * 4;
      const ci = (y * creator.w + x) * 4;
      if (!B.rgba[si + 3]) continue;
      samples.push([luma(B.rgba[si], B.rgba[si + 1], B.rgba[si + 2]), luma(creator.rgba[ci], creator.rgba[ci + 1], creator.rgba[ci + 2])]);
      for (let k = 0; k < 3; k++) sum += Math.abs(B.rgba[si + k] - creator.rgba[ci + k]);
      n++;
    }
  console.log(`creator: ${creator.w}x${creator.h} device px; mean |ΔRGB| = ${(sum / n).toFixed(2)}; luma NCC vs composed ×2 nearest = ${ncc(samples).toFixed(4)} over ${n} px`);
}

// ── 2. map ──────────────────────────────────────────────────────────────────
// draw geometry (WorldMap): ts=34 CSS (mobile "local"), h=ts*1.42, dpr=2
const dpr = 2, ts = 34;
const H = Math.round(ts * 1.42 * dpr); // ~97 device px
const W = Math.round((B.w / B.h) * H);
const bw = B.w, bh = B.h;

const downNearest = (w: number, h: number): Uint8Array => {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (((y * bh) / h | 0) * bw + ((x * bw) / w | 0)) * 4;
      out.set(B.rgba.subarray(si, si + 4), (y * w + x) * 4);
    }
  return out;
};
const downArea = (w: number, h: number): Uint8Array => {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = (x * bw) / w, x1 = ((x + 1) * bw) / w, y0 = (y * bh) / h, y1 = ((y + 1) * bh) / h;
      let r = 0, g = 0, bl = 0, a = 0, n = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(Math.max(xx + 0.5, x0), x1) - xx, wy = Math.min(Math.max(yy + 0.5, y0), y1) - yy;
          if (wx <= 0 || wy <= 0) continue;
          const si = (yy * bw + xx) * 4, wa = (B.rgba[si + 3] ? 1 : 0) * wx * wy;
          r += B.rgba[si] * wa; g += B.rgba[si + 1] * wa; bl += B.rgba[si + 2] * wa; a += wa; n += wx * wy;
        }
      const o = (y * w + x) * 4;
      if (a > n * 0.5) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = bl / a; out[o + 3] = 255; }
    }
  return out;
};

// template-match the player near screen center by luma NCC
const cx = Math.floor(map.w / 2), cy = Math.floor(map.h / 2);
const ref = downNearest(W, H);
const matchAt = (img: Uint8Array, ox: number, oy: number): number => {
  const samples: [number, number][] = [];
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2) {
      const ri = (y * W + x) * 4;
      if (!ref[ri + 3]) continue;
      const mx = cx + ox + x, my = cy + oy + y;
      if (mx < 0 || my < 0 || mx >= img.w || my >= img.h) continue;
      const mi = (my * img.w + mx) * 4;
      samples.push([luma(ref[ri], ref[ri + 1], ref[ri + 2]), luma(img.rgba[mi], img.rgba[mi + 1], img.rgba[mi + 2])]);
    }
  return ncc(samples);
};
let best = { score: -2, ox: 0, oy: 0 };
for (let oy = -50; oy <= 25; oy += 2)
  for (let ox = -50; ox <= 50; ox += 2) {
    const s = matchAt(map, ox, oy);
    if (s > best.score) best = { score: s, ox, oy };
  }
for (let oy = best.oy - 2; oy <= best.oy + 2; oy++)
  for (let ox = best.ox - 2; ox <= best.ox + 2; ox++) {
    const s = matchAt(map, ox, oy);
    if (s > best.score) best = { score: s, ox, oy };
  }
console.log(`map: player at +${best.ox},+${best.oy} of center; draw ${W}x${H} device px from ${B.w}x${B.h} (ratio ${(bh / H).toFixed(2)}); runtime-vs-composed NCC = ${best.score.toFixed(4)}`);

const score = (img: Uint8Array, label: string): void => {
  const samples: [number, number][] = [];
  let inkkept = 0, inkall = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      if (!img[si + 3]) continue;
      const mx = cx + best.ox + x, my = cy + best.oy + y;
      if (mx < 0 || my < 0 || mx >= map.w || my >= map.h) continue;
      const mi = (my * map.w + mx) * 4;
      samples.push([luma(img[si], img[si + 1], img[si + 2]), luma(map.rgba[mi], map.rgba[mi + 1], map.rgba[mi + 2])]);
      // ink = notably darker than the sprite's own median luma
      const ls = samples.map((s) => s[0]).sort((a, b) => a - b);
      const med = ls[ls.length >> 1];
      if (luma(img[si], img[si + 1], img[si + 2]) < med * 0.45) {
        inkall++;
        const lr = luma(map.rgba[mi], map.rgba[mi + 1], map.rgba[mi + 2]);
        const local: number[] = [];
        for (let oy2 = -2; oy2 <= 2; oy2++)
          for (let ox2 = -2; ox2 <= 2; ox2++) {
            const nx = mx + ox2, ny = my + oy2;
            if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h) local.push(luma(map.rgba[(ny * map.w + nx) * 4], map.rgba[(ny * map.w + nx) * 4 + 1], map.rgba[(ny * map.w + nx) * 4 + 2]));
          }
        local.sort((a, b) => a - b);
        if (lr < local[local.length >> 1] * 0.75) inkkept++;
      }
    }
  console.log(`${label}: luma NCC vs runtime = ${ncc(samples).toFixed(4)}; ink survival ${(100 * inkkept / Math.max(1, inkall)).toFixed(1)}% (${inkkept}/${inkall})`);
};
score(ref, `simulated NEAREST  (${W}x${H})`);
score(downArea(W, H), `simulated AREA-AVG (${W}x${H})`);
