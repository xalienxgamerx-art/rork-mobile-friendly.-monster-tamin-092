import {
  bodyDef, decodePart, eyeSwatch, hairSwatch, hexToRgb, lookKey, outfitSwatch,
  resolveLook, skinSwatch,
  type PartMap, type Rgb, type TamerLook,
} from "./appearance";

/**
 * High-fidelity look composition.
 *
 * The legacy pipeline renders from region-indexed part files: every pixel is
 * quantized to one of 8 slots × 8 shades, so the painterly detail of the raw
 * source art (folds, highlight transitions, ink) collapses into flat ramp
 * steps. This module is the replacement rendering path: parts are emitted at
 * high resolution by scripts/tamer-art/segment-hd.ts as
 *
 *   - `art`  — the actual (resampled) raw artwork, cropped and placed by the
 *     same anchors as the legacy parts, and
 *   - `mask` — a per-pixel region map in the SAME encoding as the legacy
 *     region-indexed files (R = slot, G = shade), but now used only to
 *     decide WHERE to recolor, never to synthesize color.
 *
 * Recoloring is a luma-preserving transfer in linear light: each driven
 * pixel keeps the source art's luminance ratio against its slot's key color
 * and adopts the target color's hue. Outlines and undriven slots (sclera,
 * metal) pass through untouched, so the ink and painted detail of the raw
 * art survive to the screen.
 *
 * This module is pure (no DOM): the browser glue lives in tamerLook.ts, and
 * tests drive it with PNG decoders.
 */

/** HD canvas geometry: 6× the 128×192 sprite. */
export const HD_W = 768;
export const HD_H = 1152;
/** 1× sprite-space origins × 6: body (0,64), head box (32,14) 64×64. */
export const HD_BODY_ORIGIN: [number, number] = [0, 384];
export const HD_HEAD_BOX: [number, number] = [192, 84];

export interface HDRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * How a slot's color is derived. `null` = keep the art's own pixels
 * (outline, sclera, metal). Outfit drives name the garment id.
 */
export type HDDrive = "skin" | "hair" | "eyes" | "brow" | "mouth" | `outfit:${string}` | null;

export interface HDDriveSpec {
  slot: number;
  /** The source art's key color for this slot (the reference luminance). */
  key: string;
  drive: HDDrive;
}

export interface HDVariant extends HDRect {
  art: string;
  mask: string;
}

export interface HDPart {
  /** Path under /tamers (e.g. "hd/body_trailwarden.png"). Variant parts carry per-face art instead. */
  art?: string;
  mask?: string;
  /** Draw order: back hair 0 → body 1 → face 2 → front hair 3. */
  layer: number;
  rect?: HDRect;
  /** Hair: per-face placement; the variant chosen by the look's face id. */
  variants?: Record<string, HDVariant>;
  slots: HDDriveSpec[];
}

export interface HDManifest {
  version: number;
  s: number;
  w: number;
  h: number;
  parts: Record<string, HDPart>;
}

export interface HDImage {
  w: number;
  h: number;
  rgba: Uint8Array;
}

export interface HDPartData {
  art: HDImage;
  mask: PartMap;
}

/** Parts are fetched with their chosen variant resolved by the compositor. */
export type HDPartSource = (part: HDPart, faceId: string) => HDPartData | null;

/** Decode a mask PNG's pixels (region-indexed encoding) into slot/shade. */
export function decodeHDMask(w: number, h: number, rgba: ArrayLike<number>): PartMap {
  return decodePart(w, h, rgba).map;
}

const srgbToLin = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const linToSrgb = (y: number): number => Math.round(255 * (y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055));

/** Linear-light luminance of an sRGB color. */
function linLuma(c: Rgb): number {
  return 0.2126 * srgbToLin(c[0]) + 0.7152 * srgbToLin(c[1]) + 0.0722 * srgbToLin(c[2]);
}

/**
 * Luma-preserving recolor: keep the pixel's luminance ratio to its key color
 * (in linear light), adopt the target's hue. out = target · Ypx / Ykey.
 * Highlights stay highlights, ink stays ink.
 */
export function transferColor(px: Rgb, key: Rgb, target: Rgb): Rgb {
  const yk = linLuma(key);
  if (yk < 1e-6) return target;
  const f = linLuma(px) / yk;
  return [
    Math.min(255, linToSrgb(srgbToLin(target[0]) * f)),
    Math.min(255, linToSrgb(srgbToLin(target[1]) * f)),
    Math.min(255, linToSrgb(srgbToLin(target[2]) * f)),
  ];
}

function rgbToHslOf(c: Rgb): [number, number, number] {
  const R = c[0] / 255, G = c[1] / 255, B = c[2] / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToRgbOf(h: number, s: number, l: number): Rgb {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function shiftHueOf(h: number, target: number, deg: number): number {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), deg);
}

function rgbHexOf(c: Rgb): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Lips derived from the skin tone (same rule as the legacy slotRamps). */
export function lipHexFor(skinHex: string): string {
  const base = hexToRgb(skinHex);
  const [h, s, l] = rgbToHslOf(base);
  const lipL = l < 0.36 ? Math.min(0.62, l * 1.35 + 0.08) : l * 0.62;
  const sat = Math.min(l > 0.75 ? 0.42 : 0.6, s + 0.12);
  return rgbHexOf(hslToRgbOf(shiftHueOf(h, 355, 14), sat, lipL));
}

/** Darken toward black by a linear-light factor (brows = the hair, darker). */
export function darkenHex(hex: string, f: number): string {
  return rgbHexOf(hexToRgb(hex).map((v) => linToSrgb(srgbToLin(v) * f)) as Rgb);
}

export interface HDComposed {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  /** Per pixel: the manifest part key that drew it ("" = transparent). */
  owner: string[];
  missing: string[];
}

interface LayerDraw {
  key: string;
  part: HDPart;
  data: HDPartData;
  rect: HDRect;
  /** slot → [keyRgb, targetRgb | null] */
  transfer: Map<number, [Rgb, Rgb | null]>;
}

/** The target color a drive resolves to for this look (null = keep art). */
function driveTarget(look: TamerLook, drive: HDDrive): string | null {
  switch (drive) {
    case null: return null;
    case "skin": return skinSwatch(look.skin)?.hex ?? null;
    case "hair": return hairSwatch(look.hairColor)?.hex ?? null;
    case "eyes": return eyeSwatch(look.eyes)?.hex ?? null;
    case "brow": return darkenHex(hairSwatch(look.hairColor)?.hex ?? "#43301f", 0.72);
    case "mouth": return lipHexFor(skinSwatch(look.skin)?.hex ?? "#d19a66");
    default: {
      if (!drive.startsWith("outfit:")) return null;
      const gid = drive.slice(7);
      const g = bodyDef(look.body)?.garments?.find((x) => x.id === gid);
      if (!g) return null;
      return outfitSwatch(g.palette, look.outfit[gid] ?? "")?.hex ?? null;
    }
  }
}

/**
 * Assemble the HD sprite for a look. Pure: parts come from `getPart`.
 * Draw order: back hair → body → face → front hair; the recolor pass then
 * runs over the composed buffer, but only pixels each part itself drew last
 * (its own mask slots), so layers never recolor each other.
 */
export function composeHD(rawLook: TamerLook, manifest: HDManifest, getPart: HDPartSource): HDComposed {
  const look = resolveLook(rawLook).look;
  const W = manifest.w, H = manifest.h;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const owner: string[] = new Array(W * H).fill("");
  const missing: string[] = [];

  const faceId = look.face.replace("face.", "");
  const hairId = look.hair.replace("hair.", "");

  const pick = (partKey: string): LayerDraw | null => {
    const part = manifest.parts[partKey];
    if (!part) return null;
    const rect = part.variants ? part.variants[faceId] : part.rect;
    if (!rect) return null;
    const data = getPart(part, faceId);
    if (!data) return null;
    const transfer = new Map<number, [Rgb, Rgb | null]>();
    for (const s of part.slots) {
      const targetHex = driveTarget(look, s.drive);
      transfer.set(s.slot, [hexToRgb(s.key), targetHex ? hexToRgb(targetHex) : null]);
    }
    return { key: partKey, part, data, rect, transfer };
  };

  const order = [
    manifest.parts[`hair.${hairId}.back`] ? `hair.${hairId}.back` : "",
    look.body,
    `face.${faceId}.${look.expression}`,
    `hair.${hairId}.front`,
  ].filter(Boolean);

  const layers: LayerDraw[] = [];
  for (const k of order) {
    const L = pick(k);
    if (!L) {
      missing.push(k);
      continue;
    }
    layers.push(L);
  }
  layers.sort((a, b) => a.part.layer - b.part.layer);

  // 1. blit every part's art, recording ownership
  for (const L of layers) {
    const { dx, dy, dw, dh } = L.rect;
    const a = L.data.art;
    if (a.w !== dw || a.h !== dh) {
      // manifest/file mismatch: never stretch to fit
      missing.push(`${L.key}: art ${a.w}×${a.h} ≠ rect ${dw}×${dh}`);
      continue;
    }
    for (let y = 0; y < dh; y++) {
      const sy = dy + y;
      if (sy < 0 || sy >= H) continue;
      for (let x = 0; x < dw; x++) {
        const sx = dx + x;
        if (sx < 0 || sx >= W) continue;
        const si = (y * a.w + x) * 4;
        if (a.rgba[si + 3] < 128) continue;
        const o = (sy * W + sx) * 4;
        rgba[o] = a.rgba[si];
        rgba[o + 1] = a.rgba[si + 1];
        rgba[o + 2] = a.rgba[si + 2];
        rgba[o + 3] = 255;
        owner[sy * W + sx] = L.key;
      }
    }
  }

  // 2. recolor pass — only driven slots, only pixels the part drew last
  for (const L of layers) {
    const { dx, dy, dw, dh } = L.rect;
    if (!L.transfer.size) continue;
    const m = L.data.mask;
    if (m.w !== dw || m.h !== dh) continue;
    for (let y = 0; y < dh; y++) {
      const sy = dy + y;
      if (sy < 0 || sy >= H) continue;
      for (let x = 0; x < dw; x++) {
        const sx = dx + x;
        if (sx < 0 || sx >= W) continue;
        const o = (sy * W + sx) * 4;
        if (owner[sy * W + sx] !== L.key) continue;
        const slot = m.slot[y * m.w + x];
        const t = L.transfer.get(slot);
        if (!t || !t[1]) continue;
        const rc = transferColor([rgba[o], rgba[o + 1], rgba[o + 2]], t[0], t[1]);
        rgba[o] = rc[0];
        rgba[o + 1] = rc[1];
        rgba[o + 2] = rc[2];
      }
    }
  }

  return { w: W, h: H, rgba, owner, missing };
}

/** Cache-key helper shared by the browser glue and tests. */
export function hdLookKey(look: TamerLook): string {
  return lookKey(look);
}
