/**
 * Procedural expression rig — TypeScript port of the Face Expression
 * Playground (single-file HTML system). Pure data + pixel buffers, no DOM.
 *
 * A face is a parametric state:
 *   - browL/browR: { height, tilt, curve }        (height raises, tilt slants)
 *   - eyeL/eyeR:   { open, lidTilt, squint, happy, gazeX, gazeY, pupil }
 *   - mouth:       { open, smile, width, skew, shiftX, teeth, tongue }
 *   - furrow, blush, sweat
 *
 * drawFace renders a state into a pixel buffer through a face STYLE
 * (eye/brow/nose/mouth shapes + detail marks). Expression presets blend
 * smoothly (mix), and ExpressionRig animates blink + gaze drift on top.
 *
 * Coordinates are integers on the layout grid; callers upscale to sprite
 * space (integer factor keeps the pixels chunky).
 */

export type Rgba = [number, number, number, number];

export interface FaceBuf {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  set(x: number, y: number, c: Rgba): void;
  /** Protects a pixel from later overwrites (eyelid shading over eyes). */
  lock(x: number, y: number): void;
  alpha(x: number, y: number): number;
  blit(other: FaceBuf, dx?: number, dy?: number): void;
}

class Buf implements FaceBuf {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  private readonly locks: Uint8Array;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.locks = new Uint8Array(width * height);
  }
  lock(x: number, y: number): void {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.locks[y * this.width + x] = 1;
  }
  private locked(x: number, y: number): boolean {
    x = Math.round(x); y = Math.round(y);
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.locks[y * this.width + x] === 1;
  }
  set(x: number, y: number, c: Rgba): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set(c, (y * this.width + x) * 4);
  }
  alpha(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? 0 : this.data[(y * this.width + x) * 4 + 3];
  }
  blit(e: FaceBuf, dx = 0, dy = 0): void {
    for (let y = 0; y < e.height; y++)
      for (let x = 0; x < e.width; x++) {
        const i = (y * e.width + x) * 4;
        if (e.data[i + 3] > 0) this.set(x + dx, y + dy, [e.data[i], e.data[i + 1], e.data[i + 2], e.data[i + 3]]);
      }
  }
}

function line(t: FaceBuf, x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    t.set(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function polyline(t: FaceBuf, pts: Array<[number, number]>, c: Rgba): void {
  if (pts.length === 1) t.set(pts[0][0], pts[0][1], c);
  for (let i = 1; i < pts.length; i++) line(t, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c);
}

// ── face state ──────────────────────────────────────────────────────────────

export interface BrowState { height: number; tilt: number; curve: number }
export interface EyeState { open: number; lidTilt: number; squint: number; happy: number; gazeX: number; gazeY: number; pupil: number }
export interface MouthState { open: number; smile: number; width: number; skew: number; shiftX: number; teeth: number; tongue: number }

export interface FaceState {
  browL: BrowState; browR: BrowState;
  eyeL: EyeState; eyeR: EyeState;
  mouth: MouthState;
  furrow: number; blush: number; sweat: number;
}

const browS = (t: Partial<BrowState> = {}): BrowState => ({ height: 0, tilt: 0, curve: 0, ...t });
const eyeS = (t: Partial<EyeState> = {}): EyeState => ({ open: 1, lidTilt: 0, squint: 0, happy: 0, gazeX: 0, gazeY: 0, pupil: 1, ...t });
const mouthS = (t: Partial<MouthState> = {}): MouthState => ({ open: 0, smile: 0, width: 0.5, skew: 0, shiftX: 0, teeth: 0, tongue: 0, ...t });

export function faceState(t: { brow?: Partial<BrowState>; eye?: Partial<EyeState>; mouth?: Partial<MouthState>; furrow?: number; blush?: number; sweat?: number } = {}): FaceState {
  return {
    browL: browS(t.brow), browR: browS(t.brow),
    eyeL: eyeS(t.eye), eyeR: eyeS(t.eye),
    mouth: mouthS(t.mouth),
    furrow: t.furrow ?? 0, blush: t.blush ?? 0, sweat: t.sweat ?? 0,
  };
}

// ── expression presets ──────────────────────────────────────────────────────

const smugBase = faceState({ brow: { height: 0.1 }, eye: { open: 0.55, lidTilt: 0.15 }, mouth: { smile: 0.5, skew: 0.7, width: 0.6 } });
smugBase.browL.height = 0.6; smugBase.browL.curve = 0.5;
smugBase.browR.height = -0.3; smugBase.browR.tilt = 0.4;

export const EXPR: Record<string, FaceState> = {
  neutral: faceState({ eye: { open: 0.85 } }),
  angry: faceState({ brow: { tilt: 0.9, height: -0.3 }, eye: { open: 0.8, lidTilt: 0.6 }, mouth: { smile: -0.3, width: 0.5 }, furrow: 1 }),
  shout: faceState({ brow: { tilt: 1, height: -0.4 }, eye: { open: 0.65, lidTilt: 0.8, squint: 0.3 }, mouth: { open: 1, smile: -0.7, width: 0.9, teeth: 1 }, furrow: 1 }),
  happy: faceState({ brow: { height: 0.3, curve: 0.5 }, eye: { open: 0.95 }, mouth: { smile: 0.8, open: 0.35, teeth: 0.5, width: 0.7 } }),
  joy: faceState({ brow: { height: 0.4, curve: 0.6 }, eye: { happy: 1 }, mouth: { smile: 1, open: 0.8, tongue: 0.6, width: 0.9 }, blush: 0.4 }),
  sad: faceState({ brow: { tilt: -0.8, height: 0.2 }, eye: { open: 0.65, lidTilt: -0.5, gazeY: 0.6, pupil: 1.1 }, mouth: { smile: -0.7, width: 0.4 } }),
  worried: faceState({ brow: { tilt: -1, height: 0.4 }, eye: { open: 1.05, pupil: 0.8, gazeX: 0.4 }, mouth: { smile: -0.5, open: 0.2, width: 0.5 }, sweat: 1 }),
  surprised: faceState({ brow: { height: 1, curve: 0.7 }, eye: { open: 1.35, pupil: 0.55 }, mouth: { open: 0.85, width: 0.2 } }),
  tired: faceState({ brow: { height: -0.2, tilt: -0.3 }, eye: { open: 0.35, lidTilt: -0.2, gazeY: 0.4 }, mouth: { smile: -0.1, width: 0.4 } }),
  embarrassed: faceState({ brow: { tilt: -0.4, height: 0.2 }, eye: { open: 0.8, gazeX: 0.7, gazeY: 0.3 }, mouth: { smile: 0.1, width: 0.3 }, blush: 1, sweat: 0.6 }),
  pain: faceState({ brow: { tilt: -0.6, height: -0.2 }, eye: { open: 0, squint: 1 }, mouth: { open: 0.5, smile: -1, teeth: 0.8, width: 0.7 }, furrow: 0.7 }),
  smug: smugBase,
};

// ── layout ──────────────────────────────────────────────────────────────────

export interface FaceLayout {
  width: number; height: number; cx: number;
  eyeY: number; eyeDX: number; eyeW: number; eyeH: number;
  browY: number; browW: number; browThick: number;
  noseY: number; mouthY: number; mouthW: number; mouthH: number;
}

/** The playground's default 56×60 layout. */
export const DEFAULT_LAYOUT: FaceLayout = {
  width: 56, height: 60, cx: 28,
  eyeY: 36, eyeDX: 10, eyeW: 10, eyeH: 7,
  browY: 30, browW: 11, browThick: 2,
  noseY: 42, mouthY: 51, mouthW: 10, mouthH: 7,
};

// ── palette ─────────────────────────────────────────────────────────────────

export type FacePalette = Record<string, string>;

const rgbaHex = (h: string): Rgba => {
  const e = parseInt(h.slice(1), 16);
  return [(e >> 16) & 255, (e >> 8) & 255, e & 255, 255];
};

export const DEFAULT_PALETTE: FacePalette = {
  outline: "#1b0b06", sclera: "#ffffff",
  iris: "#6b3a22", irisLight: "#9a5c36", pupil: "#34170d", highlight: "#ffffff",
  brow: "#3a1a0c", mouthIn: "#5b1d1d", tongue: "#d4667a", teeth: "#fff4ea",
  lip: "#c98a5c", shade: "#c48a5a", skinHi: "#f0b882",
  blush: "#e8806a", sweat: "#8ed0ff", lidLow: "#d9a173",
  crease: "#a86a40", scar: "#c8727a", scarHi: "#f0c0b0",
  freckle: "#b8733f", stubble: "#9a6a46",
};

// ── face styles ─────────────────────────────────────────────────────────────

export interface EyeShape { w: number; h: number; tilt: number; p: number; lower: number; hood: number; lash: number; lidThick?: number; irisK?: number; irisW?: number; inward?: number; band?: boolean; hl2?: boolean; crease?: boolean }
export const EYE_SHAPES: Record<string, EyeShape> = {
  sprite: { w: 1.1, h: 1.3, tilt: 0.1, p: 0.55, lower: 0.9, hood: 0, lash: 0, lidThick: 2, irisK: 1.05, irisW: 0.65, inward: 0.9, band: true, hl2: true },
  round: { w: 1, h: 1, tilt: 0, p: 0.5, lower: 0.85, hood: 0, lash: 0 },
  almond: { w: 1.15, h: 0.85, tilt: 0.15, p: 0.75, lower: 0.8, hood: 0, lash: 0 },
  narrow: { w: 1.15, h: 0.6, tilt: 0, p: 0.6, lower: 0.8, hood: 0, lash: 0 },
  wide: { w: 1.05, h: 1.25, tilt: 0, p: 0.45, lower: 1, hood: 0, lash: 0 },
  droopy: { w: 1, h: 0.95, tilt: -0.35, p: 0.55, lower: 0.95, hood: 0, lash: 0 },
  upturned: { w: 1.1, h: 0.85, tilt: 0.3, p: 0.7, lower: 0.8, hood: 0, lash: 1 },
  sharp: { w: 1.15, h: 0.7, tilt: 0.5, p: 0.85, lower: 0.7, hood: 0, lash: 1 },
  hooded: { w: 1.05, h: 0.9, tilt: 0, p: 0.5, lower: 0.85, hood: 1.5, lash: 0, crease: true },
};

export interface BrowShape { thick: number; len: number; curve: number; tilt: number; angular: number; ragged?: boolean }
export const BROW_SHAPES: Record<string, BrowShape> = {
  straight: { thick: 2, len: 1, curve: 0, tilt: 0, angular: 0 },
  arched: { thick: 2, len: 1, curve: 0.9, tilt: 0, angular: 0 },
  thick: { thick: 3, len: 1.05, curve: 0.1, tilt: 0, angular: 0 },
  thin: { thick: 1, len: 1.1, curve: 0.3, tilt: 0, angular: 0 },
  bushy: { thick: 3, len: 1.2, curve: 0, tilt: 0, angular: 0, ragged: true },
  angular: { thick: 2, len: 1, curve: 0, tilt: 0, angular: 1 },
};

export const NOSE_SHAPES = ["standard", "dot", "button", "long", "wide", "hooked", "pointed", "none"] as const;

export interface MouthShape { w: number; lip: number; upper: number; wavy: number }
export const MOUTH_SHAPES: Record<string, MouthShape> = {
  standard: { w: 1, lip: 1, upper: 0, wavy: 0 },
  thin: { w: 1.05, lip: 0, upper: 0, wavy: 0 },
  full: { w: 0.95, lip: 2, upper: 1, wavy: 0 },
  wide: { w: 1.4, lip: 1, upper: 0, wavy: 0 },
  small: { w: 0.65, lip: 1, upper: 0, wavy: 0 },
  cat: { w: 0.85, lip: 0, upper: 0, wavy: 1 },
};

export type DetailKind =
  | "laughLines" | "crowsFeet" | "foreheadLines" | "eyeBags" | "freckles" | "dimples" | "stubble"
  | "beautyMark" | "scarBrow" | "scarEye" | "scarCheek" | "scarNose" | "scarLip";

export interface Detail { kind: DetailKind; intensity?: number; seed?: number; side?: number; stitched?: boolean }

export interface FaceStyle { eye: string; brow: string; nose: string; mouth: string; details: Detail[] }

export const DEFAULT_STYLE: FaceStyle = { eye: "sprite", brow: "thick", nose: "standard", mouth: "standard", details: [] };

export const STYLE_PRESETS: Record<string, FaceStyle> = {
  default: DEFAULT_STYLE,
  plain: { eye: "round", brow: "straight", nose: "standard", mouth: "standard", details: [] },
  youth: { eye: "round", brow: "thin", nose: "button", mouth: "small", details: [{ kind: "freckles" }] },
  elf: { eye: "upturned", brow: "arched", nose: "pointed", mouth: "small", details: [] },
  rogue: { eye: "sharp", brow: "angular", nose: "pointed", mouth: "cat", details: [{ kind: "beautyMark", side: -1 }, { kind: "scarLip" }] },
  sly: { eye: "almond", brow: "thin", nose: "hooked", mouth: "thin", details: [{ kind: "eyeBags", intensity: 0.6 }, { kind: "scarEye", side: -1 }] },
  veteran: { eye: "hooded", brow: "thick", nose: "wide", mouth: "standard", details: [{ kind: "laughLines" }, { kind: "crowsFeet", intensity: 0.8 }, { kind: "scarBrow" }] },
  brute: { eye: "narrow", brow: "thick", nose: "wide", mouth: "wide", details: [{ kind: "stubble" }, { kind: "scarCheek" }, { kind: "foreheadLines", intensity: 0.6 }] },
  elder: { eye: "droopy", brow: "bushy", nose: "long", mouth: "thin", details: [{ kind: "laughLines" }, { kind: "crowsFeet" }, { kind: "foreheadLines" }, { kind: "eyeBags" }] },
  battered: { eye: "wide", brow: "straight", nose: "hooked", mouth: "full", details: [{ kind: "scarBrow", stitched: true }, { kind: "scarCheek", side: -1 }, { kind: "scarNose" }, { kind: "stubble", intensity: 0.5 }] },
};

export function randomStyle(seed: number): FaceStyle {
  const rng = makeRng(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rng() * a.length)];
  const all: DetailKind[] = ["laughLines", "crowsFeet", "foreheadLines", "eyeBags", "freckles", "dimples", "stubble", "beautyMark", "scarBrow", "scarEye", "scarCheek", "scarNose", "scarLip"];
  const chosen = [...all].sort(() => rng() - 0.5).slice(0, Math.floor(rng() * 4));
  return {
    eye: pick(Object.keys(EYE_SHAPES)),
    brow: pick(Object.keys(BROW_SHAPES)),
    nose: pick(NOSE_SHAPES),
    mouth: pick(Object.keys(MOUTH_SHAPES)),
    details: chosen.map((kind) => ({ kind, intensity: 0.5 + rng() * 0.7, seed: Math.floor(rng() * 1e6), side: pick([-1, 0, 1]) })),
  };
}

// ── drawing ─────────────────────────────────────────────────────────────────

type Rng = () => number;
export function makeRng(seed: number): Rng {
  let t = seed | 0;
  return () => {
    t = (t + 1831565813) | 0;
    let e = Math.imul(t ^ (t >>> 15), 1 | t);
    e = (e + Math.imul(e ^ (e >>> 7), 61 | e)) ^ e;
    return ((e ^ (e >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function drawBlush(t: FaceBuf, e: FaceLayout, n: Record<string, Rgba>, r: number): void {
  if (r < 0.1) return;
  for (const o of [-1, 1]) {
    const s = e.cx + o * (e.eyeDX + 1);
    const i = e.eyeY + 5, d = 4.5, u = 2.2;
    for (let g = Math.round(i - u); g <= Math.round(i + u); g++)
      for (let y = Math.round(s - d); y <= Math.round(s + d); y++) {
        if (((y - s) / d) ** 2 + ((g - i) / u) ** 2 > 1) continue;
        if (r > 0.6 || (y + g) % 2 === 0) t.set(y, g, n.blush);
      }
  }
}

function drawNoseShape(t: FaceBuf, e: FaceLayout, n: Record<string, Rgba>, r: string): void {
  const o = e.cx, s = e.noseY;
  const i = n.shade, d = n.skinHi;
  const col = (g: number, y: number, k: number, f: Rgba): void => { for (let E = y; E <= k; E++) t.set(g, s + E, f); };
  switch (r) {
    case "none": return;
    case "dot": col(o, 0, 1, i); return;
    case "button":
      t.set(o - 1, s + 1, i); t.set(o + 1, s + 1, i); col(o, -1, 0, d);
      return;
    case "long":
      col(o - 1, -4, 1, i); col(o + 1, -4, -1, d);
      t.set(o, s + 2, i); t.set(o - 1, s + 2, i);
      return;
    case "wide":
      for (const g of [-3, 3]) col(o + g, 0, 1, i);
      for (const g of [-2, 2]) t.set(o + g, s + 1, i);
      col(o, -2, 0, d);
      return;
    case "hooked":
      col(o - 1, -3, 0, i); t.set(o, s + 1, i); t.set(o + 1, s + 1, i); col(o + 1, -3, -1, d);
      return;
    case "pointed":
      col(o - 1, -3, 1, i); t.set(o, s + 2, i); t.set(o + 1, s + 1, i); col(o + 1, -3, 0, d);
      return;
    default:
      col(o - 1, -1, 1, i); t.set(o, s + 1, i); col(o + 1, -1, 0, d);
  }
}

function drawFurrow(t: FaceBuf, e: FaceLayout, n: Record<string, Rgba>, r: number): void {
  if (r < 0.2) return;
  const o = 2 + Math.round(r * 2);
  for (let s = 0; s < o; s++) {
    t.set(e.cx - 2, e.browY - 1 + s, n.shade);
    t.set(e.cx + 2, e.browY - 1 + s, n.shade);
  }
}

function drawEye(t: FaceBuf, e: FaceLayout, n: Record<string, Rgba>, side: number, o: EyeState, styleKey: string): void {
  const i = EYE_SHAPES[styleKey];
  const d = (e.eyeW * i.w) / 2;
  const u = e.cx + side * e.eyeDX;
  const g = e.eyeY;
  const y = Math.round(u - d), k = Math.round(u + d);
  const f = o.lidTilt + i.tilt;
  const E = (p: number): number => clamp((p - u) / d, -1, 1);

  if (o.happy > 0.5) {
    const p: Array<[number, number]> = [];
    for (let m = y; m <= k; m++) p.push([m, Math.round(g + e.eyeH * 0.2 - e.eyeH * 0.45 * Math.sqrt(1 - E(m) ** 2))]);
    polyline(t, p, n.outline);
    polyline(t, p.map(([m, x]) => [m, x + 1]), n.outline);
    return;
  }

  const S = e.eyeH * i.h;
  const B = S * clamp(o.open, 0, 1.4);
  const c = e.eyeH * 0.45;

  if (B < 1.5) {
    const p: Array<[number, number]> = [];
    for (let m = y; m <= k; m++) {
      const x = E(m);
      p.push([m, Math.round(g + 1 + x * x * 1.2 - side * x * f * 1.5)]);
    }
    polyline(t, p, n.outline);
    return;
  }

  const w: number[] = [], v: number[] = [];
  for (let p = y; p <= k; p++) {
    const m = E(p);
    const x = Math.pow(1 - m * m, i.p);
    const A = -side * m;
    const z = Math.round(g - (B / 2) * x + f * A * c + (i.hood ?? 0) * x);
    const Q = Math.round(g + (B / 2) * x * i.lower - o.squint * c * 0.6 * x);
    w.push(z);
    v.push(Math.max(z, Q));
  }
  w.forEach((p, m) => { for (let x = p; x <= v[m]; x++) t.set(y + m, x, n.sclera); });

  const h = Math.max(1.6, S * 0.45 * o.pupil * (i.irisK ?? 1));
  const l = h * (i.irisW ?? 0.85);
  const b = u + o.gazeX * (d - l - 0.5) - side * (i.inward ?? 0) * Math.max(0, d - l - 0.5);
  const M = g + S * 0.1 + o.gazeY * S * 0.25;
  const R = (p: number, m: number): boolean => {
    const x = p - y;
    return x >= 0 && x < w.length && m >= w[x] && m <= v[x];
  };
  for (let p = Math.floor(M - h); p <= Math.ceil(M + h); p++)
    for (let m = Math.floor(b - l); m <= Math.ceil(b + l); m++) {
      if (!R(m, p)) continue;
      const x = (m - b) / l, A = (p - M) / h, z = x * x + A * A;
      if (z > 1) continue;
      t.set(m, p, i.band ? (A < -0.15 ? n.pupil : A > 0.4 ? n.irisLight : n.iris) : z < 0.22 ? n.pupil : A > 0.35 ? n.irisLight : n.iris);
    }

  const me = Math.round(b + l * 0.35), ye = Math.round(M - h * 0.35);
  if (i.hl2) {
    const p = Math.round(b), m = Math.round(M - h * 0.5);
    for (const [z, Q] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) if (R(p + z, m + Q)) t.set(p + z, m + Q, n.highlight);
    const x = Math.round(b - l * 0.6), A = Math.round(M + h * 0.6);
    if (R(x, A)) t.set(x, A, n.highlight);
  } else if (R(me, ye)) t.set(me, ye, n.highlight);

  const fe = i.lidThick ?? 1;
  for (let p = 1; p <= fe; p++) polyline(t, w.map((m, x) => [y + x, m - p]), n.outline);

  w.forEach((p, m) => { if (Math.abs(E(y + m)) > 0.55) t.set(y + m, p, n.outline); });
  polyline(t, v.map((p, m) => [y + m, p + 1]), n.lidLow);
  w.forEach((p, m) => { for (let x = p - fe; x <= v[m] + 1; x++) t.lock(y + m, x); });

  if (i.crease) for (let p = 1; p < w.length - 1; p++) t.set(y + p, w[p] - 3, n.lidLow);

  if (i.lash) {
    const p = side < 0 ? 0 : w.length - 1, m = y + p;
    t.set(m + side, w[p] - 2, n.outline);
    t.set(m + 2 * side, w[p] - 3, n.outline);
  }
}

function drawBrowShape(t: FaceBuf, e: FaceLayout, n: Record<string, Rgba>, side: number, o: BrowState, styleKey: string): void {
  const i = BROW_SHAPES[styleKey];
  const d = (e.browW * i.len) / 2;
  const u = e.cx + side * e.eyeDX;
  const g = e.browY - o.height * 3;
  const y = Math.max(1, i.thick + e.browThick - 2);
  let k: number | null = null;
  for (let f = Math.round(u - d); f <= Math.round(u + d); f++) {
    const E = clamp((f - u) / d, -1, 1);
    const S = -side * E;
    const B = g + (o.tilt + i.tilt) * S * 3 - (o.curve + i.curve) * (1 - E * E) * 2 - i.angular * 3 * Math.max(0, 1 - Math.abs(S + 0.25) / 1.25);
    const c = S < -0.5 && y > 1 ? y - 1 : y;
    const w = k ?? B;
    for (let v = Math.round(Math.min(w, B)); v <= Math.round(Math.max(w, B)) + c - 1; v++) t.set(f, v, n.brow);
    if (i.ragged && f % 2 === 0) t.set(f, Math.round(Math.min(w, B)) - 1, n.brow);
    k = B;
  }
}

interface MouthGeom { hw: number; cx: number; H: number; my: number }

function mouthGeom(t: FaceLayout, r: MouthState, n: MouthShape): MouthGeom {
  const H = Math.round(clamp(r.open, 0, 1) * t.mouthH);
  return {
    hw: (t.mouthW * n.w * (0.6 + 0.8 * r.width)) / 2,
    cx: t.cx + r.shiftX * 3,
    H,
    my: t.mouthY - Math.round(H * 0.4),
  };
}

function drawMouthShape(t: FaceBuf, e: FaceLayout, n: Record<string, Rgba>, r: MouthState, styleKey: string): void {
  const s = MOUTH_SHAPES[styleKey];
  const { hw: i, cx: d, H: u, my: g } = mouthGeom(e, r, s);
  const y = Math.round(d - i), k = Math.round(d + i);
  const f = (h: number): number => clamp((h - d) / i, -1, 1);
  const E = (h: number): number => (u < 2 ? s.wavy * (1 - Math.abs(Math.abs(f(h)) - 0.5) * 2) * 1.5 : 0);
  const S = (h: number): number => g + r.smile * (1 - 4 * f(h) ** 2) + r.skew * f(h) * 2 + E(h);
  const B = (h: number): number => S(h) + u * Math.pow(Math.max(0, 1 - f(h) ** 2), 0.6);

  if (u < 2) {
    const h: Array<[number, number]> = [];
    for (let l = y; l <= k; l++) h.push([l, Math.round(S(l))]);
    polyline(t, h, n.outline);
    for (let l = y; l <= k; l++) {
      const b = Math.abs(f(l)), M = Math.round(S(l));
      if (s.lip && b < (s.lip === 1 ? 0.35 : 0.7)) for (let R = 1; R <= s.lip; R++) t.set(l, M + R, n.lip);
      if (s.upper && b < 0.6) t.set(l, M - 1, n.lip);
    }
    return;
  }

  const c: Array<[number, number]> = [], w: Array<[number, number]> = [];
  const v = Math.round(r.teeth * 2);
  for (let h = y; h <= k; h++) {
    const l = Math.round(S(h)), b = Math.round(B(h));
    for (let M = l + 1; M <= b; M++) {
      const R = Math.abs(f(h)) < 0.7;
      t.set(h, M, M - l <= v ? n.teeth : r.tongue > 0.05 && R && M > b - Math.round(1 + r.tongue * 2) ? n.tongue : n.mouthIn);
    }
    c.push([h, l]);
    w.push([h, b + 1]);
  }
  polyline(t, c, n.outline);
  polyline(t, w, n.outline);
  line(t, y, c[0][1], y, w[0][1], n.outline);
  line(t, k, c[c.length - 1][1], k, w[w.length - 1][1], n.outline);
  if (s.lip > 1) for (const [h, l] of w) if (Math.abs(f(h)) < 0.6) t.set(h, l + 1, n.lip);
}

function drawSweat(t: FaceBuf, e: FaceLayout, n: Record<string, Rgba>, r: number): void {
  if (r < 0.1) return;
  const o = e.cx + e.eyeDX + Math.round(e.eyeW / 2) + 3, s = e.eyeY - 9;
  [1, 3, 3, 3, 1].forEach((i, d) => {
    for (let u = 0; u < i; u++) t.set(o - ((i >> 1) as number) + u, s + d, n.sweat);
  });
  t.set(o - 1, s + 2, n.sclera);
}

function drawScar(t: FaceBuf, n: Record<string, Rgba>, x0: number, y0: number, x1: number, y1: number, stitched: boolean): void {
  const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1;
  const u = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
  const g = u ? 1 : 0, y = u ? 0 : -1;
  for (let k = 0; k < d; k++) {
    const f = Math.round(x0 + ((x1 - x0) * k) / (d - 1 || 1));
    const E = Math.round(y0 + ((y1 - y0) * k) / (d - 1 || 1));
    t.set(f, E, n.scar);
    if (stitched) {
      if (k % 3 === 1) { t.set(f - g, E - y, n.scar); t.set(f + g, E + y, n.scar); }
    } else if (k % 2 === 0 && t.alpha(f + g, E + y) === 0) t.set(f + g, E + y, n.scarHi);
  }
}

const UNDER_DETAILS = new Set<DetailKind>(["laughLines", "foreheadLines", "eyeBags", "crowsFeet", "freckles", "stubble"]);
const MARK_DETAILS = new Set<DetailKind>(["beautyMark", "scarBrow", "scarEye", "scarCheek", "scarNose", "scarLip"]);

function drawDetails(t: FaceBuf, e: FaceLayout, n: Record<string, Rgba>, r: FaceState, o: FaceStyle, s: boolean): void {
  const i = MOUTH_SHAPES[o.mouth];
  const d = mouthGeom(e, r.mouth, i);
  const u = (e.eyeW * EYE_SHAPES[o.eye].w) / 2;
  const g = clamp(r.mouth.smile, 0, 1);
  const y = [-1, 1];
  const k = (r.browL.height + r.browR.height) / 2;
  for (const f of o.details) {
    if (UNDER_DETAILS.has(f.kind) !== s) continue;
    const E = f.intensity ?? 1;
    const S: number[] = f.side === undefined ? (MARK_DETAILS.has(f.kind) ? [1] : y) : f.side === 0 ? y : [f.side];
    const B = makeRng(f.seed ?? 3);
    if (f.kind === "foreheadLines") {
      const c = Math.max(0, k), w = E * (0.4 + 0.6 * c);
      if (w < 0.25) continue;
      const v = e.browY - 5 - Math.round(c * 3);
      for (let h = 0; h < (w > 0.7 ? 3 : 2); h++) {
        const l = 7 - h, b = v - h * 2, M = w > 0.9 ? n.crease : n.shade;
        line(t, e.cx - l, b, e.cx + l, b, M);
        t.set(e.cx - l, b + 1, M); t.set(e.cx + l, b + 1, M);
      }
    } else if (f.kind === "stubble") {
      for (let c = e.noseY + 5; c < e.height - 3; c++)
        for (let w = e.cx - 17; w <= e.cx + 17; w++) {
          if (Math.abs(w - e.cx) > 17 - Math.max(0, c - (e.mouthY - 4)) * 0.6) continue;
          if (B() < 0.28 * E && !t.alpha(w, c)) t.set(w, c, n.stubble);
        }
    }
    for (const c of S) {
      const w = c < 0 ? r.eyeL : r.eyeR;
      const v = e.cx + c * e.eyeDX;
      switch (f.kind) {
        case "laughLines": {
          const h = E * (0.5 + 0.5 * g);
          if (h < 0.25) break;
          const l = e.cx + c * (d.hw + 2 + g), b = h > 0.75 ? n.crease : n.shade;
          polyline(t, [
            [e.cx + c * Math.min(5, d.hw + 2), e.noseY],
            [l, e.mouthY - 3],
            [l, e.mouthY + 2],
          ].map(([M, R]) => [Math.round(M), Math.round(R)]), b);
          break;
        }
        case "crowsFeet": {
          const h = E * (0.45 + 0.55 * Math.max(g, w.happy, w.squint));
          if (h < 0.25) break;
          const l = Math.round(v + c * (u + 2)), b = h > 0.75 ? n.crease : n.shade;
          line(t, l, e.eyeY, l + c * 3, e.eyeY - 2, b);
          line(t, l, e.eyeY + 1, l + c * 3, e.eyeY + 1, b);
          if (h > 0.6) line(t, l, e.eyeY + 2, l + c * 3, e.eyeY + 4, b);
          break;
        }
        case "eyeBags": {
          const h = E * (0.5 + 0.5 * (1 - clamp(w.open, 0, 1)));
          if (h < 0.3) break;
          const l = e.eyeY + Math.round((e.eyeH * EYE_SHAPES[o.eye].h) / 2) + 3;
          for (let b = Math.round(v - u * 0.8); b <= Math.round(v + u * 0.8); b++)
            t.set(b, l + Math.round((1 - ((b - v) / (u * 0.8)) ** 2) * 1.2), h > 0.9 ? n.crease : n.shade);
          break;
        }
        case "freckles":
          for (let h = 0; h < Math.round(10 * E); h++) {
            const l = Math.round(e.cx + c * (3 + B() * (e.eyeDX + 2)));
            const b = Math.round(e.eyeY + 5 + B() * 4);
            if (!t.alpha(l, b)) t.set(l, b, n.freckle);
          }
          break;
        case "dimples": {
          if (E * clamp((g - 0.3) / 0.5, 0, 1) < 0.3) break;
          const l = Math.round(e.cx + c * (d.hw + 2)), b = Math.round(d.my - 3 * g);
          t.set(l, b - 1, n.shade); t.set(l, b, n.crease);
          break;
        }
        case "beautyMark":
          t.set(e.cx + c * 6, e.mouthY + 3, n.outline);
          break;
        case "scarBrow": {
          const h = e.cx + c * e.eyeDX, l = e.browY - Math.round(k * 3);
          drawScar(t, n, h - c, l - 4, h + c * 2, l + 4, !!f.stitched);
          break;
        }
        case "scarEye":
          drawScar(t, n, v - c * 2, e.eyeY - 9, v + c * 2, e.eyeY + 8, !!f.stitched);
          break;
        case "scarCheek":
          drawScar(t, n, e.cx + c * (e.eyeDX + 3), e.eyeY + 4, e.cx + c * (e.eyeDX - 4), e.eyeY + 11, !!f.stitched);
          break;
        case "scarNose":
          drawScar(t, n, e.cx - c * 5, e.noseY - 1, e.cx + c * 5, e.noseY - 5, !!f.stitched);
          break;
        case "scarLip":
          drawScar(t, n, d.cx + c * 3, e.mouthY - 4, d.cx + c * 4, e.mouthY + 4, !!f.stitched);
          break;
      }
    }
  }
}

/** Render a face state into a fresh pixel buffer (features only, transparent bg). */
export function drawFace(t: FaceState, e: FaceLayout = DEFAULT_LAYOUT, palette?: FacePalette, r: FaceStyle = DEFAULT_STYLE): FaceBuf {
  const o = new Buf(e.width, e.height);
  const s: Record<string, Rgba> = {};
  const src = palette ?? DEFAULT_PALETTE;
  for (const [k, v] of Object.entries(src)) s[k] = rgbaHex(v);
  drawBlush(o, e, s, t.blush);
  drawNoseShape(o, e, s, r.nose);
  drawFurrow(o, e, s, t.furrow);
  drawDetails(o, e, s, t, r, true);
  drawEye(o, e, s, -1, t.eyeL, r.eye);
  drawEye(o, e, s, 1, t.eyeR, r.eye);
  drawBrowShape(o, e, s, -1, t.browL, r.brow);
  drawBrowShape(o, e, s, 1, t.browR, r.brow);
  drawMouthShape(o, e, s, t.mouth, r.mouth);
  drawSweat(o, e, s, t.sweat);
  drawDetails(o, e, s, t, r, false);
  return o;
}

// ── blending + animation ────────────────────────────────────────────────────

function blendState(t: unknown, e: unknown, n: number): unknown {
  if (typeof t === "number" && typeof e === "number") return t + (e - t) * n;
  const r: Record<string, unknown> = {};
  for (const o of Object.keys(t as Record<string, unknown>)) {
    r[o] = blendState((t as Record<string, unknown>)[o], (e as Record<string, unknown>)[o], n);
  }
  return r;
}

/** Linear blend of two face states (n in 0..1). */
export function mixStates(t: FaceState, e: FaceState, n: number): FaceState {
  return blendState(t, e, n) as FaceState;
}

/** Deep clone of a face state. */
export function cloneState(t: FaceState): FaceState {
  return blendState(t, t, 0) as FaceState;
}

/** Jitter a preset slightly so repeated expressions feel less canned. */
export function jitterState(t: FaceState, seed: number, n = 0.15): FaceState {
  const r = makeRng(seed);
  const o = (i: unknown): unknown => {
    if (typeof i === "number") return i + (r() - 0.5) * 2 * n;
    const d: Record<string, unknown> = {};
    for (const u of Object.keys(i as Record<string, unknown>)) d[u] = o((i as Record<string, unknown>)[u]);
    return d;
  };
  const s = o(t) as FaceState;
  s.eyeL.happy = t.eyeL.happy;
  s.eyeR.happy = t.eyeR.happy;
  for (const i of [s.eyeL, s.eyeR]) i.open = clamp(i.open, 0, 1.4);
  s.mouth.open = clamp(s.mouth.open, 0, 1);
  return s;
}

/**
 * Expression animator: smooth transitions between states, auto-blink and
 * gaze drift. `update(dtSeconds)` returns the state to render this frame.
 */
export class ExpressionRig {
  autoBlink = true;
  autoGaze = true;
  private from: FaceState;
  private to: FaceState;
  private t = 1;
  private dur = 0;
  private blink = -1;
  private nextBlink: number;
  private gaze: [number, number] = [0, 0];
  private gazeTarget: [number, number] = [0, 0];
  private gazeTimer = 1;
  private rng: Rng;

  constructor(initial: FaceState | string = "neutral", seed = 1) {
    this.from = cloneState(typeof initial === "string" ? EXPR[initial] : initial);
    this.to = cloneState(typeof initial === "string" ? EXPR[initial] : initial);
    this.rng = makeRng(seed);
    this.nextBlink = 1 + this.rng() * 3;
  }

  set(e: FaceState | string, n = 0.15): void {
    this.from = this.sample();
    this.to = cloneState(typeof e === "string" ? EXPR[e] : e);
    this.t = 0;
    this.dur = Math.max(n, 1e-6);
  }

  triggerBlink(): void {
    if (this.blink < 0) this.blink = 0;
  }

  private sample(): FaceState {
    const e = clamp(this.t, 0, 1);
    const n = e * e * (3 - 2 * e);
    return mixStates(this.from, this.to, n);
  }

  update(e: number): FaceState {
    this.t = Math.min(1, this.t + e / this.dur);
    const n = this.sample();
    if (this.autoGaze) {
      this.gazeTimer -= e;
      if (this.gazeTimer <= 0) {
        this.gazeTarget = [(this.rng() - 0.5) * 0.7, (this.rng() - 0.5) * 0.4];
        this.gazeTimer = 0.8 + this.rng() * 2.5;
      }
      const r = Math.min(1, e * 12);
      this.gaze = [
        this.gaze[0] + (this.gazeTarget[0] - this.gaze[0]) * r,
        this.gaze[1] + (this.gazeTarget[1] - this.gaze[1]) * r,
      ];
      for (const o of [n.eyeL, n.eyeR]) {
        o.gazeX = clamp(o.gazeX + this.gaze[0], -1, 1);
        o.gazeY = clamp(o.gazeY + this.gaze[1], -1, 1);
      }
    }
    if (this.autoBlink) {
      if (this.blink < 0) {
        this.nextBlink -= e;
        if (this.nextBlink <= 0) this.blink = 0;
      } else {
        this.blink += e / 0.16;
        if (this.blink >= 1) {
          this.blink = -1;
          this.nextBlink = 2 + this.rng() * 4;
        }
      }
    }
    if (this.blink >= 0 && n.eyeL.happy < 0.5) {
      const r = Math.sin(Math.PI * Math.min(1, this.blink));
      n.eyeL.open *= 1 - r;
      n.eyeR.open *= 1 - r;
    }
    return n;
  }
}
