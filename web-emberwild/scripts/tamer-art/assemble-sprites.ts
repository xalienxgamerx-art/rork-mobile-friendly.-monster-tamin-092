/**
 * Assemble freshly generated raw assets into the modular sprite system.
 *
 * Inputs  raw/gen/body_<id>.png  (painted body+clothing+blank head, transparent bg)
 *         raw/gen/face_<f>_<e>.png (floating features only)
 * Outputs hd/body_<id>_p6.png (+ _p6_mask.png)  — full-canvas 768×1152
 *         hd/face_<f>_<e>_p6.png (+ _p6_mask.png) — features on a shared face rect
 * Bodies are anchored on head geometry: head width scaled to HEAD_W, head top at
 * HEAD_TOP, head center at CX — the canonical slot the existing hair parts wrap.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { decodePng, encodePng } from "./png";

const base = new URL("../../../web-emberwild/public/tamers/", import.meta.url);
const gen = new URL("./raw/gen/", import.meta.url);

const W = 768, H = 1152;
const HEAD_W = 169, HEAD_TOP = 136, CX = 384;
const BODIES = ["trailwarden", "brawler", "wayfarer", "scout"] as const;
const FACES = ["stern", "easy", "bright", "keen"] as const;
const EXPRS = ["neutral", "grin"] as const;

type Img = { w: number; h: number; rgba: Uint8Array };
const load = (dir: URL, p: string): Img => decodePng(new Uint8Array(readFileSync(new URL(p, dir))));


/** Remove the baked radial glow in two passes: warm glow pixels from the borders,
 *  then the neutral-dark ring — flooding stops at the pure-black outline (max < 14),
 *  so the character interior is never reached. */
function keyBackground(img: Img): Img {
  const { w, h } = img, px = img.rgba;
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number, pass: 0 | 1): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bg[i]) return;
    const o = i * 4, a = px[o + 3];
    if (a < 40) { bg[i] = 1; stack.push(i); return; }
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const m = Math.max(r, g, b);
    if (pass === 0) { if (r - b > 8) { bg[i] = 1; stack.push(i); } return; }
    if (m >= 14 && m < 80 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25) { bg[i] = 1; stack.push(i); }
  };
  for (let pass = 0 as 0 | 1; pass <= 1; pass = pass + 1 as 1) {
    stack.length = 0;
    // seed pass 1 from pixels already keyed in pass 0
    if (pass === 1) {
      for (let i = 0; i < w * h; i++) {
        if (!bg[i]) continue;
        const x = i % w, y = (i / w) | 0;
        push(x + 1, y, 1); push(x - 1, y, 1); push(x, y + 1, 1); push(x, y - 1, 1);
      }
    } else {
      for (let x = 0; x < w; x++) { push(x, 0, 0); push(x, h - 1, 0); }
      for (let y = 0; y < h; y++) { push(0, y, 0); push(w - 1, y, 0); }
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      push(x + 1, y, pass); push(x - 1, y, pass); push(x, y + 1, pass); push(x, y - 1, pass);
    }
  }
  // keep only the largest connected foreground component
  const comp = new Int32Array(w * h);
  let best = 0, bestSize = 0, compId = 0;
  for (let s = 0; s < w * h; s++) {
    if (bg[s] || comp[s]) continue;
    compId++; let size = 0;
    const st = [s]; comp[s] = compId;
    while (st.length) {
      const i = st.pop()!; size++;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!bg[j] && !comp[j]) { comp[j] = compId; st.push(j); }
        }
    }
    if (size > bestSize) { bestSize = size; best = compId; }
  }
  const out = new Uint8Array(px);
  for (let i = 0; i < w * h; i++) if (bg[i] || comp[i] !== best) out[i * 4 + 3] = 0;
  return { w, h, rgba: out };
}

function trim(img: Img): { img: Img } {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.rgba[(y * img.w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * img.w + (x + x0)) * 4, d = (y * w + x) * 4;
      out[d] = img.rgba[s]; out[d + 1] = img.rgba[s + 1]; out[d + 2] = img.rgba[s + 2]; out[d + 3] = img.rgba[s + 3];
    }
  return { img: { w, h, rgba: out } };
}

/** Head metrics from the SKIN mask (the head is the topmost skin blob): profile skin
 *  row-widths from the first skin row until the neck pinch (width collapses below 45%
 *  of the head maximum). Tendrils and clothing can't inflate it — only skin counts. */
function headMetrics(img: Img) {
  const isSkin = (o: number): boolean => {
    const r = img.rgba[o], g = img.rgba[o + 1], b = img.rgba[o + 2], a = img.rgba[o + 3];
    return a > 128 && r > 130 && g > 85 && g < 235 && r - b > 25 && r - g >= 10 && r - g <= 85;
  };
  const widths: number[] = [], centers: number[] = [];
  let firstSkin = -1;
  for (let y = 0; y < img.h; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < img.w; x++)
      if (isSkin((y * img.w + x) * 4)) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 < 0 || (firstSkin >= 0 && false)) { widths.push(0); centers.push(img.w / 2); continue; }
    if (firstSkin < 0) firstSkin = widths.length;
    widths.push(x1 - x0 + 1); centers.push((x0 + x1) / 2);
  }
  if (firstSkin < 0) throw new Error("no skin found");
  let maxW = 0, neck = Math.floor(img.h * 0.6);
  const sustained = (y: number, lim: number): boolean => {
    for (let k = 0; k < 6; k++) if (widths[y + k] >= lim) return false;
    return true;
  };
  for (let y = firstSkin; y < img.h * 0.6; y++) {
    maxW = Math.max(maxW, widths[y]);
    const after = y - firstSkin - Math.round(0.9 * maxW);
    if (after >= 0 && maxW > 60 && widths[y] > 0 && widths[y] < maxW * 0.5 && sustained(y, maxW * 0.55)) { neck = y; break; }
  }
  let headW = 0, cxSum = 0, n = 0;
  for (let y = firstSkin; y < neck; y++) { headW = Math.max(headW, widths[y]); cxSum += centers[y]; n++; }
  return { top: firstSkin, bottom: neck, headW, cx: cxSum / Math.max(1, n) };
}

/** Area-average resample of src into dst rect (dx,dy,dw,dh) on a full canvas. */
function blitScaled(dst: Img, src: Img, dx: number, dy: number, dw: number, dh: number): void {
  for (let y = 0; y < dh; y++) {
    const sy0 = (y * src.h) / dh, sy1 = ((y + 1) * src.h) / dh;
    for (let x = 0; x < dw; x++) {
      const sx0 = (x * src.w) / dw, sx1 = ((x + 1) * src.w) / dw;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(sy0); sy < Math.min(src.h, Math.ceil(sy1)); sy++)
        for (let sx = Math.floor(sx0); sx < Math.min(src.w, Math.ceil(sx1)); sx++) {
          const sp = (sy * src.w + sx) * 4;
          const wA = (Math.min(sx1, sx + 1) - Math.max(sx0, sx)) * (Math.min(sy1, sy + 1) - Math.max(sy0, sy));
          if (wA <= 0) continue;
          const sa = (src.rgba[sp + 3] / 255) * wA;
          r += src.rgba[sp] * sa; g += src.rgba[sp + 1] * sa; b += src.rgba[sp + 2] * sa; a += sa; area += wA;
        }
      if (a <= 0) continue;
      const dp = ((dy + y) * dst.w + dx + x) * 4;
      const outA = a / area;
      dst.rgba[dp] = r / a; dst.rgba[dp + 1] = g / a; dst.rgba[dp + 2] = b / a;
      dst.rgba[dp + 3] = Math.round(Math.min(1, outA) * 255);
    }
  }
}

const blank = (w: number, h: number): Img => ({ w, h, rgba: new Uint8Array(w * h * 4) });
const write = (dir: URL, p: string, img: Img): void => writeFileSync(new URL(p, dir), encodePng(img.w, img.h, img.rgba));

// ── bodies ───────────────────────────────────────────────────────────────────
const headStats: { top: number; bottom: number; cx: number; w: number }[] = [];
for (const id of BODIES) {
  const trimmed = trim(keyBackground(load(gen, `p6_body_${id}.png`)));
  const hm = headMetrics(trimmed.img);
  const s = Math.min(HEAD_W / hm.headW, (H - HEAD_TOP) / trimmed.img.h);
  const sw = Math.round(trimmed.img.w * s), sh = Math.round(trimmed.img.h * s);
  const dx = Math.round(CX - hm.cx * s), dy = Math.round(HEAD_TOP);
  const canvas: Img = { w: W, h: H, rgba: new Uint8Array(W * H * 4) };
  blitScaled(canvas, trimmed.img, dx, dy, sw, sh);
  write(base, `hd/body_${id}_p6.png`, canvas);
  write(base, `hd/body_${id}_p6_mask.png`, blank(W, H));
  headStats.push({ top: HEAD_TOP, bottom: HEAD_TOP + Math.round((hm.bottom - hm.top) * s), cx: CX, w: hm.headW * s });
  console.log(`body_${id}: src ${trimmed.img.w}x${trimmed.img.h} headW ${hm.headW} scale ${s.toFixed(3)} bottom ${(dy + sh)} headBottom ${headStats.at(-1)!.bottom}`);
}

// ── faces ────────────────────────────────────────────────────────────────────
const avgTop = headStats.reduce((a, b) => a + b.top, 0) / headStats.length;
const avgBottom = headStats.reduce((a, b) => a + b.bottom, 0) / headStats.length;
const headH = avgBottom - avgTop;
const avgW = headStats.reduce((a, b) => a + b.w, 0) / headStats.length;
console.log(`avg head W ${avgW.toFixed(1)} H ${headH.toFixed(1)}`);
const FW = 240, FH = 220;
console.log(`avg head: top ${avgTop} bottom ${avgBottom} h ${headH}`);

for (const f of FACES)
  for (const e of EXPRS) {
    const rawName = (p: string) => (existsSync(new URL(`p8_face_${p}.png`, gen)) ? `p8_face_${p}.png` : `p7_face_${p}.png`);
    const raw = load(gen, rawName(`${f}_${e}`));
    // p7/p8 raws are clean transparent-background art (features + cel shading);
    // clear low-alpha haze, drop stray small marks low near the chin (second
    // mouth lines the model sometimes adds), trim, keep the rest.
    const px = raw.rgba, w = raw.w, h = raw.h, n = w * h;
    const out = new Uint8Array(px);
    for (let i = 0; i < n; i++) if (out[i * 4 + 3] < 40) out[i * 4 + 3] = 0;
    {
      const comp = new Int32Array(n);
      const sizes: number[] = [];
      const y0s: number[] = [];
      const stack: number[] = [];
      for (let s = 0; s < n; s++) {
        if (!out[s * 4 + 3] || comp[s]) continue;
        const id = sizes.length + 1;
        let size = 0, y0 = h;
        stack.push(s); comp[s] = id;
        while (stack.length) {
          const i = stack.pop()!; size++;
          const x = i % w, y = (i / w) | 0;
          if (y < y0) y0 = y;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const j = ny * w + nx;
              if (out[j * 4 + 3] && !comp[j]) { comp[j] = id; stack.push(j); }
            }
        }
        sizes.push(size); y0s.push(y0);
      }
      const biggest = Math.max(...sizes, 1);
      for (let id = 1; id <= sizes.length; id++) {
        if (sizes[id - 1] >= 0.05 * biggest || y0s[id - 1] <= 0.88 * h) continue;
        for (let i = 0; i < n; i++) if (comp[i] === id) out[i * 4 + 3] = 0;
      }
    }
    const trimmed = trim({ w, h, rgba: out });
    const s = Math.min((0.78 * avgW) / trimmed.img.w, (0.68 * headH) / trimmed.img.h);
    const sw = Math.round(trimmed.img.w * s), sh = Math.round(trimmed.img.h * s);
    const canvas: Img = { w: FW, h: FH, rgba: new Uint8Array(FW * FH * 4) };
    const dx = Math.round(FW / 2 - sw / 2), dy = Math.round(FH / 2 - sh / 2);
    blitScaled(canvas, trimmed.img, dx, dy, sw, sh);
    write(base, `hd/face_${f}_${e}_p8.png`, canvas);
    write(base, `hd/face_${f}_${e}_p8_mask.png`, blank(FW, FH));
    console.log(`face_${f}_${e}: src ${trimmed.img.w}x${trimmed.img.h} scale ${s.toFixed(3)} -> ${sw}x${sh}`);
  }

// ── manifest ─────────────────────────────────────────────────────────────────
const manifestPath = new URL("hd/manifest.json", base);
const M = JSON.parse(readFileSync(manifestPath, "utf8"));
M.version = (M.version ?? 1) + 1;
for (const id of BODIES) {
  const p = M.parts[`body.${id}`];
  p.art = `hd/body_${id}_p6.png`;
  p.mask = `hd/body_${id}_p6_mask.png`;
  p.rect = { dx: 0, dy: 0, dw: W, dh: H };
}
for (const f of FACES)
  for (const e of EXPRS) {
    const p = M.parts[`face.${f}.${e}`];
    p.art = `hd/face_${f}_${e}_p8.png`;
    p.mask = `hd/face_${f}_${e}_p8_mask.png`;
    p.rect = { dx: CX - FW / 2, dy: Math.round(avgTop + 0.55 * headH) - FH / 2, dw: FW, dh: FH };
  }

// ── hair: rescale to the new head geometry ──────────────────────────────────
const f = avgW / 169; // old head slot was 169 wide
const OCx = 384.5, OCy = 224; // old head center (face rect {300,136,169,176})
const NCx = CX, NCy = avgTop + headH / 2;
console.log(`hair scale ${f.toFixed(3)}: old center (${OCx},${OCy}) -> new (${NCx},${NCy.toFixed(1)})`);
for (const [key, part] of Object.entries<any>(M.parts)) {
  if (!key.startsWith("hair.")) continue;
  for (const [vid, v] of Object.entries<any>(part.variants)) {
    const art = decodePng(new Uint8Array(readFileSync(new URL(v.art, base))));
    const mask = decodePng(new Uint8Array(readFileSync(new URL(v.mask, base))));
    const aw = Math.round(art.w * f), ah = Math.round(art.h * f);
    const ca: Img = { w: aw, h: ah, rgba: new Uint8Array(aw * ah * 4) };
    blitScaled(ca, { w: art.w, h: art.h, rgba: art.rgba }, 0, 0, aw, ah);
    const cm: Img = { w: aw, h: ah, rgba: new Uint8Array(aw * ah * 4) };
    blitScaled(cm, { w: mask.w, h: mask.h, rgba: mask.rgba }, 0, 0, aw, ah);
    if (/_p6/.test(v.art)) continue; // already migrated, keep idempotent
    const name = (p: string) => p.replace(/_p[0-9]/, "_p6");
    write(base, name(v.art), ca);
    write(base, name(v.mask), cm);
    v.art = name(v.art);
    v.mask = name(v.mask);
    v.dx = Math.round(NCx - (OCx - v.dx) * f);
    v.dy = Math.round(HEAD_TOP + (v.dy - HEAD_TOP) * f); // hair hangs from the crown: anchor at head top
    v.dw = Math.round(v.dw * f);
    v.dh = Math.round(v.dh * f);
  }
}
writeFileSync(manifestPath, JSON.stringify(M));
console.log("hair rescaled");

writeFileSync(manifestPath, JSON.stringify(M));
console.log("manifest updated, version", M.version);
