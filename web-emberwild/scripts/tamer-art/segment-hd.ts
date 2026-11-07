/**
 * HD part emitter — the high-fidelity replacement for the region-indexed
 * pipeline. For every part this crops the RAW source art, resamples it ONCE
 * into its destination rectangle on the 768×1152 HD canvas (6× the 128×192
 * sprite), and classifies the DEST art into region slots — the mask decides
 * where recoloring happens at runtime, never what color a pixel is.
 *
 * Outputs (public/tamers/hd/):
 *   <part>.png        the artwork itself (cropped raw, dest-sized)
 *   <part>_mask.png   per-pixel slot map (same encoding as the legacy
 *                     region-indexed files: R=slot·16+8, G=shade·32+16)
 *   manifest.json     dest rects, layer order, per-slot recolor drives
 *
 * Validation sheets (scripts/tamer-art/):
 *   hd_preview.png    12 looks, recolored HD composites (½ scale)
 *   hd_legacy_compare.png  the legacy 128×192 composites for the same seeds
 *   hd_hair_fit.png   head close-ups: every hair style on every face
 *
 * The face parts are the AI face RAWS (fully illustrated heads with real
 * eyes/brows/nose/mouth) — the legacy pipeline's 24×16 span tables replaced
 * them; here the raws finally render. A look's `head` field affects the
 * legacy path only: at HD the face raw supplies the whole head.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { decodePng, encodePng } from "./png";
import {
  BODIES, FACES, HAIRS, SHADES, SLOT, SPRITE_H, SPRITE_W,
  colorDistance, composeLook, decodePart, luma, generateLook,
  type Rgb,
} from "../../src/game/appearance";
import { composeHD, type HDManifest, type HDPartData, type HDImage } from "../../src/game/tamerLookHDCore";

const OUT_DIR = new URL("../../public/tamers/hd/", import.meta.url);
const RAW_DIR = new URL("./raw/", import.meta.url);

// ── geometry (6× the 1× sprite space) ───────────────────────────────────────

const S = 6;
const W = SPRITE_W * S; // 768
const H = SPRITE_H * S; // 1152
const BODY_BOX = 128 * S; // 768 square, bottom-anchored at H
const HEAD_BOX_W = 64 * S; // 384
const HEAD_BOX_H = 60 * S; // fit height (legacy head fit: min(60/h, 64/w))
const HEAD_BOX_X = 32 * S; // 192
const HEAD_BOX_Y = 14 * S; // 84

// ── raw image helpers (same semantics as segment.ts, at raw resolution) ─────

interface Img {
  w: number;
  h: number;
  rgba: Uint8Array;
}

const loadRaw = (name: string): Img => {
  const png = decodePng(new Uint8Array(readFileSync(new URL(`${name}.png`, RAW_DIR))));
  return { w: png.w, h: png.h, rgba: png.rgba };
};

const hexRgb = (hex: string): Rgb => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const SKIN_KEY = hexRgb("#c8956c");
const HAIR_KEY = hexRgb("#6b4a2c");
const OUTLINE_KEY: Rgb = [34, 23, 28];

const atA = (im: Img, x: number, y: number): number => (x < 0 || y < 0 || x >= im.w || y >= im.h ? 0 : im.rgba[(y * im.w + x) * 4 + 3]);
const opaque = (im: Img, x: number, y: number): boolean => atA(im, x, y) >= 100;
const colAt = (im: Img, x: number, y: number): Rgb => {
  const i = (y * im.w + x) * 4;
  return [im.rgba[i], im.rgba[i + 1], im.rgba[i + 2]];
};
const lumas = (im: Img): number[] => {
  const out = new Array<number>(im.w * im.h);
  for (let i = 0; i < im.w * im.h; i++) out[i] = luma([im.rgba[i * 4], im.rgba[i * 4 + 1], im.rgba[i * 4 + 2]]);
  return out;
};

function blurLuma(im: Img, L: number[], passes = 1): number[] {
  let cur = L;
  for (let p = 0; p < passes; p++) {
    const out = new Array<number>(im.w * im.h);
    for (let y = 0; y < im.h; y++)
      for (let x = 0; x < im.w; x++) {
        const i = y * im.w + x;
        if (!opaque(im, x, y)) {
          out[i] = cur[i];
          continue;
        }
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= im.w || ny >= im.h || !opaque(im, nx, ny)) continue;
            sum += cur[ny * im.w + nx];
            n++;
          }
        out[i] = n ? sum / n : cur[i];
      }
    cur = out;
  }
  return cur;
}

const satOf = (c: Rgb): number => {
  const mx = Math.max(...c), mn = Math.min(...c);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

function trim(im: Img): [number, number, number, number] {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++)
    for (let x = 0; x < im.w; x++)
      if (opaque(im, x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new Error("empty image");
  return [x0, y0, x1, y1];
}

function crop(im: Img, x0: number, y0: number, x1: number, y1: number): Img {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * im.w + (x0 + x)) * 4;
      out.set(im.rgba.subarray(s, s + 4), (y * w + x) * 4);
    }
  return { w, h, rgba: out };
}

/** Box-filter resample: color = mean of opaque source px, alpha from coverage. */
function resample(im: Img, tw: number, th: number): Img {
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    const sy0 = (ty * im.h) / th, sy1 = ((ty + 1) * im.h) / th;
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = (tx * im.w) / tw, sx1 = ((tx + 1) * im.w) / tw;
      let r = 0, g = 0, b = 0, n = 0, box = 0;
      for (let y = Math.floor(sy0); y < Math.min(im.h, Math.ceil(sy1)); y++)
        for (let x = Math.floor(sx0); x < Math.min(im.w, Math.ceil(sx1)); x++) {
          const area = Math.max(0, Math.min(x + 1, sx1) - Math.max(x, sx0)) * Math.max(0, Math.min(y + 1, sy1) - Math.max(y, sy0));
          if (area <= 0) continue;
          box += area;
          if (atA(im, x, y) < 100) continue;
          const c = colAt(im, x, y);
          r += c[0] * area;
          g += c[1] * area;
          b += c[2] * area;
          n += area;
        }
      const o = (ty * tw + tx) * 4;
      if (n > 0 && n / box >= 0.3) {
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = 255;
      }
    }
  }
  return { w: tw, h: th, rgba: out };
}

function largestBlob(im: Img, mask: boolean[]): { mask: boolean[]; bbox: [number, number, number, number]; size: number } {
  const seen = new Array(im.w * im.h).fill(false);
  let best: { mask: boolean[]; bbox: [number, number, number, number]; size: number } | null = null;
  const stack: number[] = [];
  for (let s = 0; s < im.w * im.h; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp: number[] = [];
    stack.length = 0;
    stack.push(s);
    seen[s] = true;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % im.w, y = (i / im.w) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= im.w || ny >= im.h) continue;
        const j = ny * im.w + nx;
        if (mask[j] && !seen[j]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
    if (!best || comp.length > best.size) {
      let bx0 = im.w, by0 = im.h, bx1 = -1, by1 = -1;
      const cm = new Array(im.w * im.h).fill(false);
      for (const i of comp) {
        cm[i] = true;
        const x = i % im.w, y = (i / im.w) | 0;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
      best = { mask: cm, bbox: [bx0, by0, bx1, by1], size: comp.length };
    }
  }
  if (!best) throw new Error("no blob found");
  return best;
}

const percentile = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

/** Remove a flat magenta field (#ff00ff) and despill its fringe. */
function unMagenta(im: Img): Img {
  const kill = new Array(im.w * im.h).fill(false);
  for (let i = 0; i < im.w * im.h; i++) {
    const r = im.rgba[i * 4], g = im.rgba[i * 4 + 1], b = im.rgba[i * 4 + 2];
    kill[i] = im.rgba[i * 4 + 3] < 100 || (r > 140 && b > 140 && g < Math.min(r, b) - 50);
  }
  for (let y = 0; y < im.h; y++)
    for (let x = 0; x < im.w; x++) {
      const i = y * im.w + x;
      if (kill[i]) continue;
      const near = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < im.w && ny < im.h && kill[ny * im.w + nx];
      });
      if (!near) continue;
      const o = i * 4, r = im.rgba[o], g = im.rgba[o + 1], b = im.rgba[o + 2];
      if (r > g + 25 && b > g + 25) {
        im.rgba[o] = Math.round((r + g) / 2);
        im.rgba[o + 2] = Math.round((b + g) / 2);
      }
    }
  return im;
}

// ── slot assignment (at destination resolution) ─────────────────────────────

interface Key {
  slot: number;
  rgb: Rgb;
  base: number; // luma of the key color = authored shade 4
}

function classify(im: Img, keys: Key[]): { slot: Uint8Array; shade: Uint8Array } {
  const slot = new Uint8Array(im.w * im.h).fill(255);
  const outline = keys.find((k) => k.slot === SLOT.outline)!;
  const rest = keys.filter((k) => k.slot !== SLOT.outline);
  const L = lumas(im);
  const darkish = Array.from(L, (l) => l < 92);
  const nearEdge = (x: number, y: number): boolean => {
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= im.w || ny >= im.h || !opaque(im, nx, ny)) return true;
      }
    return false;
  };
  for (let y = 0; y < im.h; y++)
    for (let x = 0; x < im.w; x++) {
      const i = y * im.w + x;
      if (!opaque(im, x, y)) continue;
      const c = colAt(im, x, y);
      let best: Key | null = null, bd = Infinity;
      for (const k of rest) {
        const d = colorDistance(c, k.rgb);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      // "thin": dark pixel not part of a solid dark block (probe scaled to dest res)
      const thin = ![[0, -1], [0, 1], [-1, 0], [1, 0]].every(([dx, dy]) => {
        for (let m = 1; m <= 3; m++) {
          const nx = x + dx * m, ny = y + dy * m;
          if (nx < 0 || ny < 0 || nx >= im.w || ny >= im.h || !darkish[ny * im.w + nx]) return false;
        }
        return true;
      });
      const outlineish = L[i] < 92 && (satOf(c) < 0.5 || L[i] < 40) && (colorDistance(c, outline.rgb) <= bd || L[i] < 50);
      const isOutline = outlineish && (nearEdge(x, y) || thin);
      slot[i] = (isOutline ? outline : best!).slot;
    }
  // kill isolated misassignments: a pixel whose 3×3 majority is elsewhere is
  // painterly noise
  for (let y = 0; y < im.h; y++)
    for (let x = 0; x < im.w; x++) {
      const i = y * im.w + x;
      if (slot[i] === 255) continue;
      const counts = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= im.w || ny >= im.h) continue;
          const s = slot[ny * im.w + nx];
          if (s === 255 || s === slot[i]) continue;
          counts.set(s, (counts.get(s) ?? 0) + 1);
        }
      let bestS = -1, bestN = 0;
      for (const [s, n] of counts) if (n > bestN) { bestN = n; bestS = s; }
      const sameN = 8 - (counts.get(255) ?? 0) - [...counts.values()].reduce((a, b) => a + b, 0);
      if (bestN >= 4 || (sameN <= 1 && bestN >= 3)) slot[i] = bestS;
    }
  return { slot, shade: shades(im, keys, slot, blurLuma(im, L, 2)) };
}

function shades(im: Img, keys: Key[], slot: Uint8Array, L: number[]): Uint8Array {
  const shade = new Uint8Array(im.w * im.h);
  for (const k of keys) {
    const devs: number[] = [];
    for (let i = 0; i < im.w * im.h; i++) if (slot[i] === k.slot) devs.push(L[i] - k.base);
    if (!devs.length) continue;
    const ref = Math.max(20, percentile(devs.map(Math.abs), 0.85));
    for (let i = 0; i < im.w * im.h; i++) {
      if (slot[i] !== k.slot) continue;
      shade[i] = Math.max(0, Math.min(SHADES - 1, Math.round(4 + (L[i] - k.base) * 2.2 / ref)));
    }
  }
  return shade;
}

function repair(keys: Key[], slot: Uint8Array, im: Img): void {
  for (const k of keys) {
    if (k.slot === SLOT.outline) continue;
    if (slot.some((s) => s === k.slot)) continue;
    const scored: [number, number][] = [];
    for (let i = 0; i < im.w * im.h; i++) {
      if (slot[i] === 255 || slot[i] === SLOT.outline || slot[i] === k.slot) continue;
      scored.push([colorDistance(colAt(im, i % im.w, (i / im.w) | 0), k.rgb), i]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    if (!scored.length || scored[0][0] > 160) throw new Error(`slot ${k.slot}: no pixels and no plausible donors`);
    for (let n = 0; n < Math.min(200, scored.length); n++) slot[scored[n][1]] = k.slot;
  }
}

/** Refine a seed key to the mean of its nearby pixels (2 k-means rounds). */
function refineKey(im: Img, seed: Rgb): Rgb {
  let c = seed;
  for (let round = 0; round < 2; round++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < im.w * im.h; i++) {
      const o = i * 4;
      if (im.rgba[o + 3] < 100) continue;
      const px: Rgb = [im.rgba[o], im.rgba[o + 1], im.rgba[o + 2]];
      if (colorDistance(px, c) < 90) {
        r += px[0];
        g += px[1];
        b += px[2];
        n++;
      }
    }
    if (n < 40) break;
    c = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }
  return c;
}

function rgbHex(c: Rgb): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Garment id → the key color the generator was asked for (shared with segment.ts). */
const BODY_KEYS: Record<string, Record<string, string>> = {
  "body.trailwarden": { coat: "#a83232", shirt: "#e8dcc8", belt: "#6b4a2c", trousers: "#4a3826", boots: "#2a1f1a", metal: "#d4a843" },
  "body.brawler": { vest: "#2e7d76", wraps: "#e8dcc8", sash: "#a33327", trousers: "#5a4632", shoes: "#2a1f1a" },
  "body.wayfarer": { capelet: "#9a4a6a", dress: "#4a5a7a", belt: "#6b4a2c", leggings: "#3a3a4a", boots: "#4a342a", metal: "#d4a843" },
  "body.scout": { jacket: "#2f6f6a", top: "#e8dcc8", trousers: "#5a4632", gloves: "#3a2a20", boots: "#2a1f1a", satchel: "#8a6a3a", metal: "#d4a843" },
};

// ── emission ────────────────────────────────────────────────────────────────

const manifest: HDManifest = { version: 1, s: S, w: W, h: H, parts: {} };

function emitArtAndMask(name: string, art: Img, slot: Uint8Array, shade: Uint8Array, maskArtToSlots = false): { art: string; mask: string } {
  if (maskArtToSlots) {
    // hair raws wear the mannequin's skin: hair art renders directly, so any
    // pixel the classifier did not claim must go transparent
    for (let i = 0; i < art.w * art.h; i++) if (slot[i] === 255) art.rgba[i * 4 + 3] = 0;
  }
  const mask = new Uint8Array(art.w * art.h * 4);
  for (let i = 0; i < art.w * art.h; i++) {
    if (slot[i] === 255) continue;
    mask[i * 4] = slot[i] * 16 + 8;
    mask[i * 4 + 1] = (slot[i] === SLOT.outline ? 3 : Math.max(1, Math.min(6, shade[i]))) * 32 + 16;
    mask[i * 4 + 2] = 128;
    mask[i * 4 + 3] = 255;
  }
  writeFileSync(new URL(`${name}.png`, OUT_DIR), Buffer.from(encodePng(art.w, art.h, art.rgba)));
  writeFileSync(new URL(`${name}_mask.png`, OUT_DIR), Buffer.from(encodePng(art.w, art.h, mask)));
  return { art: `hd/${name}.png`, mask: `hd/${name}_mask.png` };
}

// ── bodies ──────────────────────────────────────────────────────────────────

function buildBodyHd(bodyId: string): void {
  const raw = loadRaw(bodyId.replace("body.", "body_"));
  const [x0, y0, x1, y1] = trim(raw);
  const cropped = crop(raw, x0, y0, x1, y1);
  const scale = Math.min(BODY_BOX / cropped.h, BODY_BOX / cropped.w);
  const dw = Math.max(1, Math.round(cropped.w * scale)), dh = Math.max(1, Math.round(cropped.h * scale));
  const art = resample(cropped, dw, dh);
  const dx = Math.round(W / 2 - dw / 2);
  const dy = H - dh; // feet at the sprite's bottom edge

  const def = BODIES.find((b) => b.id === bodyId)!;
  const skinKey = refineKey(art, SKIN_KEY);
  const keys: Key[] = [
    { slot: SLOT.outline, rgb: OUTLINE_KEY, base: luma(OUTLINE_KEY) },
    { slot: SLOT.skin, rgb: skinKey, base: luma(SKIN_KEY) },
  ];
  for (const g of def.garments ?? []) {
    const hex = BODY_KEYS[bodyId]?.[g.id];
    if (!hex) throw new Error(`${bodyId}: no key color for garment ${g.id}`);
    keys.push({ slot: g.slot, rgb: refineKey(art, hexRgb(hex)), base: luma(hexRgb(hex)) });
  }
  if (BODY_KEYS[bodyId]?.metal && def.slots.includes(SLOT.metal)) {
    const rgb = hexRgb(BODY_KEYS[bodyId].metal);
    keys.push({ slot: SLOT.metal, rgb: refineKey(art, rgb), base: luma(rgb) });
  }
  const { slot, shade } = classify(art, keys);
  repair(keys, slot, art);
  const files = emitArtAndMask(bodyId.replace(".", "_"), art, slot, shade);
  manifest.parts[bodyId] = {
    ...files,
    layer: 1,
    rect: { dx, dy, dw, dh },
    slots: [
      { slot: SLOT.skin, key: rgbHex(skinKey), drive: "skin" },
      ...(def.garments ?? []).map((g) => {
        const hex = BODY_KEYS[bodyId][g.id];
        return { slot: g.slot, key: rgbHex(refineKey(art, hexRgb(hex))), drive: `outfit:${g.id}` as const };
      }),
    ],
  };
}

// ── faces (full illustrated heads) ──────────────────────────────────────────

interface FaceRef {
  cx: number;
  chin: number;
  width: number;
  top: number;
}

const FACE_HD_KEYS: Key[] = [
  { slot: SLOT.outline, rgb: OUTLINE_KEY, base: luma(OUTLINE_KEY) },
  { slot: SLOT.skin, rgb: SKIN_KEY, base: luma(SKIN_KEY) },
  { slot: SLOT.iris, rgb: hexRgb("#3a2618"), base: luma(hexRgb("#3a2618")) },
  { slot: SLOT.sclera, rgb: hexRgb("#f2ece2"), base: luma(hexRgb("#f2ece2")) },
  { slot: SLOT.mouth, rgb: hexRgb("#a85a50"), base: luma(hexRgb("#a85a50")) },
  { slot: SLOT.brow, rgb: hexRgb("#5a4030"), base: luma(hexRgb("#5a4030")) },
];

const faceRefs = new Map<string, FaceRef>();

function buildFaceHd(faceId: string, expr: string): void {
  const raw = unMagenta(loadRaw(`face_${faceId}_${expr}`));
  const [x0, y0, x1, y1] = trim(raw);
  const cropped = crop(raw, x0, y0, x1, y1);
  const scale = Math.min(HEAD_BOX_H / cropped.h, HEAD_BOX_W / cropped.w);
  const dw = Math.max(1, Math.round(cropped.w * scale)), dh = Math.max(1, Math.round(cropped.h * scale));
  const art = resample(cropped, dw, dh);
  const dx = HEAD_BOX_X + Math.round(HEAD_BOX_W / 2 - dw / 2);
  const dy = HEAD_BOX_Y + HEAD_BOX_H - dh; // bottom of the head box = the neck row
  const skinKey = refineKey(art, SKIN_KEY);
  const keys = FACE_HD_KEYS.map((k) => (k.slot === SLOT.skin ? { ...k, rgb: skinKey } : k));
  const { slot, shade } = classify(art, keys);
  repair(FACE_HD_KEYS, slot, art);
  const files = emitArtAndMask(`face_${faceId}_${expr}`, art, slot, shade);
  manifest.parts[`face.${faceId}.${expr}`] = {
    ...files,
    layer: 2,
    rect: { dx, dy, dw, dh },
    slots: [
      { slot: SLOT.skin, key: rgbHex(skinKey), drive: "skin" },
      { slot: SLOT.iris, key: "#3a2618", drive: "eyes" },
      { slot: SLOT.mouth, key: "#a85a50", drive: "mouth" },
      { slot: SLOT.brow, key: "#5a4030", drive: "brow" },
    ],
  };
  if (expr === "neutral") {
    const skinMask = Array.from(slot, (s) => s === SLOT.skin);
    const blob = largestBlob(art, skinMask);
    const [bx0, by0, bx1, by1] = blob.bbox;
    faceRefs.set(faceId, { cx: dx + (bx0 + bx1 + 1) / 2, chin: dy + by1 + 1, width: bx1 - bx0 + 1, top: dy });
  }
}

// ── hair (front + back, per-face placement) ─────────────────────────────────

/** Per-style fit, measured off the raw generations (shared with segment.ts). */
const HAIR_FIT: Record<string, { cx: number; chin: number; cheekL: number; cheekR: number }> = {
  crop: { cx: 428, chin: 794, cheekL: 255, cheekR: 635 },
  tousled: { cx: 489, chin: 882, cheekL: 279, cheekR: 699 },
  bob: { cx: 440, chin: 805, cheekL: 209, cheekR: 670 },
  shag: { cx: 467, chin: 867, cheekL: 277, cheekR: 657 },
  mane: { cx: 391, chin: 529, cheekL: 265, cheekR: 517 },
  braid: { cx: 341, chin: 655, cheekL: 172, cheekR: 509 },
};

/** Per-style visual tuning, shared with segment.ts (shrink/dy) + backDy (HD only). */
const HAIR_TUNE: Record<string, { dy?: number; shrink?: number; backDy?: number }> = {
  crop: { shrink: 0.95 },
  tousled: { shrink: 0.9 },
  bob: { shrink: 0.88 },
  shag: { shrink: 0.88 },
  mane: { shrink: 0.8 },
  braid: { shrink: 0.78 },
};

/**
 * Clean a hair crop into (art, mask) at its destination size: the mannequin's
 * skin and the background are dropped; hair keeps its art pixels, dark ink
 * near hair becomes the outline slot. Classification runs on the
 * DEST-resampled art so mask and art agree pixel for pixel.
 */
function hairPartData(raw: Img, scale: number): { art: Img; slot: Uint8Array; shade: Uint8Array } {
  const [x0, y0, x1, y1] = trim(raw);
  const cropped = crop(raw, x0, y0, x1, y1);
  const dw = Math.max(1, Math.round(cropped.w * scale)), dh = Math.max(1, Math.round(cropped.h * scale));
  const art = resample(cropped, dw, dh);
  const L = lumas(art);
  const Lb = blurLuma(art, L, 2);

  // The mannequin's skin varies per generation (some raws render it much
  // lighter than the global skin key), and orange highlight strands sit
  // between skin and hair in color — a naive refineKey seeded with the global
  // skin key converges onto the HIGHLIGHTS (they are closer to it than the
  // mannequin's skin is). So refine the skin reference only over pixels that
  // already look like skin (desaturated and light), drop everything close to
  // it, then take hair as (near the hair key) OR (saturated warm — the
  // highlights), then keep the main blob only.
  let sR = 0, sG = 0, sB = 0, sN = 0;
  for (let i = 0; i < art.w * art.h; i++) {
    if (!opaque(art, i % art.w, (i / art.w) | 0)) continue;
    const px: Rgb = [art.rgba[i * 4], art.rgba[i * 4 + 1], art.rgba[i * 4 + 2]];
    if (satOf(px) >= 0.58 || L[i] <= 120) continue;
    sR += px[0];
    sG += px[1];
    sB += px[2];
    sN++;
  }
  const skinRef: Rgb = sN > 500 ? [Math.round(sR / sN), Math.round(sG / sN), Math.round(sB / sN)] : SKIN_KEY;
  const hairish = new Array(art.w * art.h).fill(false);
  for (let i = 0; i < art.w * art.h; i++) {
    if (!opaque(art, i % art.w, (i / art.w) | 0)) continue;
    const px: Rgb = [art.rgba[i * 4], art.rgba[i * 4 + 1], art.rgba[i * 4 + 2]];
    if (colorDistance(px, skinRef) < 60) continue;
    if (colorDistance(px, HAIR_KEY) < 150 || satOf(px) >= 0.6) hairish[i] = true;
  }
  const hair = largestBlob(art, hairish).mask;

  // dilate `hair` by radius R (separable box, two passes) to find nearby ink
  const dilate = (src: boolean[], R: number): boolean[] => {
    let cur = src;
    for (let pass = 0; pass < 2; pass++) {
      const tmp = new Array(src.length).fill(false);
      for (let y = 0; y < art.h; y++)
        for (let x = 0; x < art.w; x++) {
          const i = y * art.w + x;
          if (cur[i]) continue;
          for (let d = -R; d <= R; d++) {
            const nx = x + d;
            if (nx >= 0 && nx < art.w && cur[y * art.w + nx]) { tmp[i] = true; break; }
          }
        }
      const out = new Array(src.length).fill(false);
      for (let y = 0; y < art.h; y++)
        for (let x = 0; x < art.w; x++) {
          const i = y * art.w + x;
          if (tmp[i]) continue;
          for (let d = -R; d <= R; d++) {
            const ny = y + d;
            if (ny >= 0 && ny < art.h && tmp[ny * art.w + x]) { out[i] = true; break; }
          }
        }
      cur = out;
    }
    return cur;
  };
  const R = Math.max(3, Math.round(18 * scale));
  const nearHair = dilate(hair, R);
  const outlinePx = new Array(art.w * art.h).fill(false);
  for (let i = 0; i < art.w * art.h; i++) {
    if (!opaque(art, i % art.w, (i / art.w) | 0) || hair[i]) continue;
    const px: Rgb = [art.rgba[i * 4], art.rgba[i * 4 + 1], art.rgba[i * 4 + 2]];
    if (L[i] < 40 && colorDistance(px, skinRef) >= 60 && nearHair[i]) outlinePx[i] = true;
  }

  const slot = new Uint8Array(art.w * art.h).fill(255);
  for (let i = 0; i < art.w * art.h; i++) {
    if (outlinePx[i]) slot[i] = SLOT.outline;
    else if (hair[i]) slot[i] = SLOT.hair;
  }
  // dark ink nearly surrounded by hair is strand shadow, not outline
  for (let y = 1; y < art.h - 1; y++)
    for (let x = 1; x < art.w - 1; x++) {
      const i = y * art.w + x;
      if (slot[i] !== SLOT.outline) continue;
      let hairN = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++)
          if ((ox || oy) && slot[(y + oy) * art.w + x + ox] === SLOT.hair) hairN++;
      if (hairN >= 6) slot[i] = SLOT.hair;
    }

  // shades relative to the hair key (informational; runtime transfer is continuous)
  const keys: Key[] = [
    { slot: SLOT.outline, rgb: OUTLINE_KEY, base: luma(OUTLINE_KEY) },
    { slot: SLOT.hair, rgb: HAIR_KEY, base: luma(HAIR_KEY) },
  ];
  const shade = shades(art, keys, slot, Lb);
  return { art, slot, shade };
}

// hair px that wrap the raw mannequin's jaw (inside the face's jaw ellipse
// below the mid-face) read as a thin ring around the composed chin — drop them.
function trimJawWrap(art: Img, slot: Uint8Array, ref: FaceRef, txx: number, tyy: number): void {
  const faceH = ref.chin - ref.top;
  const ecx = ref.cx;
  const ecy = ref.chin - 0.1 * faceH;
  const rx = (ref.width / 2) * 0.92;
  const ry = 0.16 * faceH;
  for (let y = 0; y < art.h; y++)
    for (let x = 0; x < art.w; x++) {
      const i = y * art.w + x;
      if (slot[i] !== SLOT.hair && slot[i] !== SLOT.outline) continue;
      const ddx = txx + x - ecx;
      const ddy = tyy + y - ecy;
      if ((ddx * ddx) / (rx * rx) + (ddy * ddy) / (ry * ry) >= 1) continue;
      const yy = tyy + y;
      if (yy < ref.chin - 0.22 * faceH || yy > ref.chin + 0.14 * faceH) continue;
      art.rgba[i * 4 + 3] = 0;
      slot[i] = 0;
    }
}

function buildHairHd(styleId: string): void {
  const id = styleId.replace("hair.", "");
  const tune = HAIR_TUNE[id] ?? {};
  const fit = HAIR_FIT[id];
  if (!fit) throw new Error(`no HAIR_FIT for ${styleId}`);

  // front: one cleaned variant per face (scale follows that face's cheek span)
  const frontRaw = loadRaw(`hair_${id}_front`);
  const frontVariants: NonNullable<import("../../src/game/tamerLookHDCore").HDPart["variants"]> = {};
  for (const [faceId, ref] of faceRefs) {
    const scale = (ref.width / (fit.cheekR - fit.cheekL)) * (tune.shrink ?? 1);
    const [x0, y0] = trim(frontRaw);
    const { art, slot, shade } = hairPartData(frontRaw, scale);
    // place the measured face-oval center at the face's center-x, the
    // measured chin at the face's chin row
    const txx = Math.round(ref.cx - (fit.cx - x0) * scale);
    const tyy = Math.round(ref.chin + (tune.dy ?? 0) * S - (fit.chin - y0) * scale);
    trimJawWrap(art, slot, ref, txx, tyy);
    const files = emitArtAndMask(`hair_${id}_front__${faceId}`, art, slot, shade, true);
    frontVariants[faceId] = { ...files, dx: txx, dy: tyy, dw: art.w, dh: art.h };
  }
  manifest.parts[`hair.${id}.front`] = {
    layer: 3,
    variants: frontVariants,
    slots: [{ slot: SLOT.hair, key: rgbHex(HAIR_KEY), drive: "hair" }],
  };

  // back: behind everything, crown roughly at the head's crown, center-x on
  // the face's center-x
  let backRaw: Img | null = null;
  try {
    backRaw = loadRaw(`hair_${id}_back`);
  } catch {
    backRaw = null;
  }
  if (backRaw) {
    const backVariants: NonNullable<import("../../src/game/tamerLookHDCore").HDPart["variants"]> = {};
    for (const [faceId, ref] of faceRefs) {
      const scale = (ref.width / (fit.cheekR - fit.cheekL)) * (tune.shrink ?? 1);
      const { art, slot, shade } = hairPartData(backRaw, scale);
      const txx = Math.round(ref.cx - art.w / 2);
      const tyy = Math.round(ref.top - 8 * S + (tune.backDy ?? 0) * S);
      const files = emitArtAndMask(`hair_${id}_back__${faceId}`, art, slot, shade, true);
      backVariants[faceId] = { ...files, dx: txx, dy: tyy, dw: art.w, dh: art.h };
    }
    manifest.parts[`hair.${id}.back`] = {
      layer: 0,
      variants: backVariants,
      slots: [{ slot: SLOT.hair, key: rgbHex(HAIR_KEY), drive: "hair" }],
    };
  }
}

// ── run ─────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

for (const b of BODIES) buildBodyHd(b.id);
for (const f of FACES) for (const e of ["neutral", "grin"] as const) buildFaceHd(f.id.replace("face.", ""), e);
for (const h of HAIRS) buildHairHd(h.id);

writeFileSync(new URL("manifest.json", OUT_DIR), JSON.stringify(manifest));

const variantCount = Object.values(manifest.parts).reduce((n, p) => n + (p.variants ? Object.keys(p.variants).length : 0), 0);
console.log(`segment-hd: wrote ${Object.keys(manifest.parts).length} parts (${variantCount} variants)`);

// ── validation: compose the emitted parts back into sprites ─────────────────

const partCache = new Map<string, HDPartData>();
function loadHdPart(src: string): HDPartData | null {
  const hit = partCache.get(src);
  if (hit) return hit;
  const art = decodePng(new Uint8Array(readFileSync(new URL(`../../public/tamers/${src}`, import.meta.url))));
  const maskPng = decodePng(new Uint8Array(readFileSync(new URL(`../../public/tamers/${src.slice(0, -4)}_mask.png`, import.meta.url))));
  const data: HDPartData = { art: { w: art.w, h: art.h, rgba: art.rgba }, mask: decodePart(maskPng.w, maskPng.h, maskPng.rgba).map };
  partCache.set(src, data);
  return data;
}

// preview sheet: 12 looks × recolored HD composite at ½ scale
{
  const seeds = [7, 91, 233, 512, 777, 1024, 1333, 1701, 1999, 2444, 2828, 3333];
  const SC = 0.5;
  const cellW = Math.round(W * SC) + 8;
  const cellH = Math.round(H * SC) + 8;
  const cols = 6;
  const rows = Math.ceil(seeds.length / cols);
  const SW = cellW * cols, SH = cellH * rows;
  const sheet = new Uint8Array(SW * SH * 4);
  for (let i = 0; i < SW * SH; i++) sheet.set([46, 40, 52, 255], i * 4);
  const missingAll: string[] = [];
  seeds.forEach((seed, i) => {
    const c = composeHD(generateLook(seed), manifest, (part, faceId) => {
      const v = part.variants?.[faceId];
      return loadHdPart(v ? v.art : part.art);
    });
    missingAll.push(...c.missing);
    const X = (i % cols) * cellW + 4;
    const Y = Math.floor(i / cols) * cellH + 4;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4;
        if (!c.rgba[si + 3]) continue;
        if (x % 2 || y % 2) continue;
        const o = ((Y + (y >> 1)) * SW + X + (x >> 1)) * 4;
        sheet[o] = c.rgba[si];
        sheet[o + 1] = c.rgba[si + 1];
        sheet[o + 2] = c.rgba[si + 2];
        sheet[o + 3] = 255;
      }
  });
  writeFileSync(new URL("./hd_preview.png", import.meta.url), Buffer.from(encodePng(SW, SH, sheet)));
  console.log(`segment-hd: preview sheet hd_preview.png (${SW}×${SH}), missing: ${missingAll.length ? missingAll.join(", ") : "none"}`);
  if (missingAll.length) process.exitCode = 1;
}

// legacy comparison: the current 128×192 composites for the same seeds
{
  const seeds = [7, 91, 233, 512, 777, 1024];
  const SC = 3;
  const cellW = SPRITE_W * SC + 8;
  const cellH = SPRITE_H * SC + 8;
  const sheet = new Uint8Array(cellW * seeds.length * cellH * 4);
  for (let i = 0; i < cellW * seeds.length * cellH; i++) sheet.set([46, 40, 52, 255], i * 4);
  seeds.forEach((seed, i) => {
    const c = composeLook(generateLook(seed), (src) => {
      const png = decodePng(new Uint8Array(readFileSync(new URL(`../../public${src}`, import.meta.url))));
      return decodePart(png.w, png.h, png.rgba).map;
    });
    const X = i * cellW + 4;
    for (let y = 0; y < SPRITE_H; y++)
      for (let x = 0; x < SPRITE_W; x++) {
        const si = (y * SPRITE_W + x) * 4;
        if (!c.rgba[si + 3]) continue;
        for (let dy = 0; dy < SC; dy++)
          for (let dx = 0; dx < SC; dx++) {
            const o = ((4 + y * SC + dy) * cellW * seeds.length + X + x * SC + dx) * 4;
            sheet[o] = c.rgba[si];
            sheet[o + 1] = c.rgba[si + 1];
            sheet[o + 2] = c.rgba[si + 2];
            sheet[o + 3] = 255;
          }
      }
  });
  writeFileSync(new URL("./hd_legacy_compare.png", import.meta.url), Buffer.from(encodePng(cellW * seeds.length, cellH, sheet)));
  console.log("segment-hd: legacy comparison hd_legacy_compare.png");
}

// hair fit close-ups: every style on every face (head box + margin)
{
  const styles = HAIRS.map((h) => h.id.replace("hair.", ""));
  const faces = FACES.map((f) => f.id.replace("face.", ""));
  const box = 460;
  const cols = faces.length;
  const rows = styles.length;
  const SW = box * cols, SH = box * rows;
  const sheet = new Uint8Array(SW * SH * 4);
  for (let i = 0; i < SW * SH; i++) sheet.set([46, 40, 52, 255], i * 4);
  const put = (im: HDImage, dx: number, dy: number, ox: number, oy: number): void => {
    for (let y = 0; y < im.h; y++)
      for (let x = 0; x < im.w; x++) {
        const si = (y * im.w + x) * 4;
        if (!im.rgba[si + 3]) continue;
        const px = ox + dx + x, py = oy + dy + y;
        if (px < 0 || py < 0 || px >= SW || py >= SH) continue;
        const o = (py * SW + px) * 4;
        sheet[o] = im.rgba[si];
        sheet[o + 1] = im.rgba[si + 1];
        sheet[o + 2] = im.rgba[si + 2];
        sheet[o + 3] = 255;
      }
  };
  styles.forEach((style, r) => {
    faces.forEach((face, c2) => {
      // each cell is centered on the head box (384 wide, centered in the cell)
      const ox = c2 * box + Math.round((box - HEAD_BOX_W) / 2);
      const oy = r * box + Math.round((box - HEAD_BOX_H) / 2);
      const back = manifest.parts[`hair.${style}.back`];
      const bv = back?.variants?.[face];
      if (bv) put(loadHdPart(bv.art)!.art, bv.dx, bv.dy, ox, oy);
      const faceEntry = manifest.parts[`face.${face}.neutral`];
      if (faceEntry?.rect) put(loadHdPart(faceEntry.art)!.art, faceEntry.rect.dx, faceEntry.rect.dy, ox, oy);
      const front = manifest.parts[`hair.${style}.front`];
      const v = front?.variants?.[face];
      if (v) put(loadHdPart(v.art)!.art, v.dx, v.dy, ox, oy);
    });
  });
  writeFileSync(new URL("./hd_hair_fit.png", import.meta.url), Buffer.from(encodePng(SW, SH, sheet)));
  console.log("segment-hd: hair fit sheet hd_hair_fit.png");
}
