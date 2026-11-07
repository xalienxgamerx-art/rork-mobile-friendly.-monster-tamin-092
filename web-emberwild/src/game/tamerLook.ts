import { assetFiles, composeLook, decodePart, lookKey, resolveLook, SPRITE_H, SPRITE_W, validatePart, validateRegistry, type AssetFile, type PartMap, type TamerLook } from "./appearance";
import { composeHD, decodeHDMask, type HDManifest, type HDPart, type HDPartData } from "./tamerLookHDCore";

/**
 * Browser side of the rival appearance system: loads the region-indexed part
 * PNGs once, validates each against the registry, and caches composed
 * sprites per look. Composition happens once per distinct look (not per
 * frame); the map just blits the cached canvas.
 *
 * Failure policy: a part that fails to load or validate is treated as
 * missing. The compositor skips missing layers; if the body itself is
 * unavailable `getLookSprite` returns null and the map keeps its simple
 * fallback figure. Nothing here throws into the render loop.
 */

type PartState = { map: PartMap } | "loading" | "failed";

const parts = new Map<string, PartState>();
const listeners = new Set<() => void>();
const cache = new Map<string, HTMLCanvasElement | null>();
const CACHE_MAX = 48;
const scaledCache = new Map<string, HTMLCanvasElement>();
const SCALED_MAX = 96;
let started = false;
let pending = 0;
const problems: string[] = [];

function notify(): void {
  // looks composed from a partial part set are re-composed once more parts arrive
  cache.clear();
  scaledCache.clear();
  hdCache.clear();
  for (const l of listeners) l();
}

// ── HD (raw-art) pipeline ───────────────────────────────────────────────────
//
// The region-indexed parts above are the legacy/fallback source. The visual
// source of truth is the HD set emitted by scripts/tamer-art/segment-hd.ts:
// real (resampled) raw artwork per part plus a mask that only says WHERE to
// recolor. Composition runs once per distinct look into a 768×1152 canvas;
// the map and creator just scale/blit that canvas.

const HD_MANIFEST_URL = "/tamers/hd/manifest.json";
/** Manifest art paths already carry the `hd/` prefix (e.g. "hd/body_brawler.png"). */
const HD_PART_BASE = "/tamers/";
type HDPartState = { data: HDPartData } | "loading" | "failed";
let hdManifest: HDManifest | "loading" | "failed" = "loading";
let hdFetchStarted = false;
const hdParts = new Map<string, HDPartState>(); // key: manifest art path
const hdCache = new Map<string, HTMLCanvasElement | null>();
const hdFailedLooks = new Set<string>();
const HD_CACHE_MAX = 12;
const HD_PARTS_MAX = 28;

function loadImgEl(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("failed to load"));
    img.src = src;
  });
}

function imgPixels(img: HTMLImageElement): { w: number; h: number; rgba: Uint8ClampedArray } {
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const c = cv.getContext("2d", { willReadFrequently: true });
  if (!c) throw new Error("2d context unavailable");
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height);
  return { w: d.width, h: d.height, rgba: d.data };
}

function ensureHdManifest(): void {
  if (hdFetchStarted || typeof document === "undefined") return;
  hdFetchStarted = true;
  pending++;
  fetch(HD_MANIFEST_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<HDManifest>;
    })
    .then((m) => {
      if (!m || !m.parts || !m.w || !m.h) throw new Error("malformed");
      hdManifest = m;
      pending--;
      notify();
    })
    .catch((e) => {
      problems.push(`hd manifest: ${(e as Error).message}`);
      hdManifest = "failed";
      pending--;
      notify();
    });
}

function loadHDPart(artPath: string): void {
  hdParts.set(artPath, "loading");
  pending++;
  const maskPath = artPath.replace(/\.png$/, "_mask.png");
  Promise.all([loadImgEl(`${HD_PART_BASE}${artPath}`), loadImgEl(`${HD_PART_BASE}${maskPath}`)])
    .then(([a, m]) => {
      const art = imgPixels(a);
      const mimg = imgPixels(m);
      if (mimg.w !== art.w || mimg.h !== art.h) throw new Error(`mask ${mimg.w}×${mimg.h} ≠ art ${art.w}×${art.h}`);
      hdParts.set(artPath, {
        data: {
          art: { w: art.w, h: art.h, rgba: new Uint8Array(art.rgba) },
          mask: decodeHDMask(mimg.w, mimg.h, mimg.rgba),
        },
      });
      trimHDParts();
      pending--;
      notify();
    })
    .catch((e) => {
      problems.push(`hd part ${artPath}: ${(e as Error).message}`);
      hdParts.set(artPath, "failed");
      pending--;
      notify();
    });
}

function trimHDParts(): void {
  while (hdParts.size > HD_PARTS_MAX) {
    const oldest = hdParts.keys().next().value;
    if (oldest === undefined) break;
    hdParts.delete(oldest);
  }
}

function hdArtPath(part: HDPart, faceId: string): string | null {
  const p = part.variants ? part.variants[faceId] : part;
  return p?.art ?? null;
}

function hdPartDataOf(part: HDPart, faceId: string): HDPartData | null {
  const artPath = hdArtPath(part, faceId);
  if (!artPath) return null;
  const st = hdParts.get(artPath);
  return st && typeof st === "object" ? st.data : null;
}

/**
 * The HD sprite for a look, or null to fall through to the legacy path
 * (while HD parts load or when HD is unavailable for this look). Returns a
 * 768×1152 canvas composed once per distinct look.
 */
function getHDSprite(look: TamerLook, key: string): HTMLCanvasElement | null {
  ensureHdManifest();
  if (hdManifest === "loading" || hdManifest === "failed" || hdFailedLooks.has(key)) return null;
  const M = hdManifest;
  const faceId = look.face.replace("face.", "");
  const hairId = look.hair.replace("hair.", "");
  const needed: string[] = [];
  for (const k of [`hair.${hairId}.back`, look.body, `face.${faceId}.${look.expression}`, `hair.${hairId}.front`]) {
    const part = M.parts[k];
    if (!part) continue; // optional layer (e.g. back hair)
    const artPath = hdArtPath(part, faceId);
    if (!artPath) continue;
    const st = hdParts.get(artPath);
    if (!st) loadHDPart(artPath);
    else if (st === "failed") return null; // HD unavailable here — legacy
    needed.push(artPath);
  }
  const hit = hdCache.get(key);
  if (hit !== undefined) {
    hdCache.delete(key);
    hdCache.set(key, hit);
    return hit;
  }
  const ready = needed.every((p) => typeof hdParts.get(p) === "object");
  if (!ready) {
    // parts still decoding: the legacy sprite shows meanwhile
    return null;
  }
  const composed = composeHD(look, M, hdPartDataOf);
  if (composed.missing.length) {
    hdFailedLooks.add(key);
    problems.push(`hd compose ${key}: ${composed.missing.join("; ")}`);
    return null;
  }
  const cv = document.createElement("canvas");
  cv.width = composed.w;
  cv.height = composed.h;
  const c = cv.getContext("2d");
  if (!c) return null;
  c.putImageData(new ImageData(new Uint8ClampedArray(composed.rgba), composed.w, composed.h), 0, 0);
  if (pending === 0) {
    hdCache.set(key, cv);
    while (hdCache.size > HD_CACHE_MAX) {
      const oldest = hdCache.keys().next().value;
      if (oldest === undefined) break;
      hdCache.delete(oldest);
    }
  }
  return cv;
}

function loadPart(f: AssetFile): void {
  parts.set(f.src, "loading");
  pending++;
  const img = new Image();
  img.decoding = "async";
  const done = (state: PartState): void => {
    parts.set(f.src, state);
    pending--;
    notify();
  };
  img.onload = () => {
    try {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const c = cv.getContext("2d", { willReadFrequently: true });
      if (!c) return done("failed");
      c.drawImage(img, 0, 0);
      const data = c.getImageData(0, 0, cv.width, cv.height).data;
      const dec = decodePart(cv.width, cv.height, data);
      const errs = validatePart(f, cv.width, cv.height, dec);
      if (errs.length) {
        problems.push(...errs);
        console.warn(`[emberwild] tamer part rejected: ${errs.join("; ")}`);
        return done("failed");
      }
      done({ map: dec.map });
    } catch (e) {
      problems.push(`${f.src}: ${(e as Error).message}`);
      done("failed");
    }
  };
  img.onerror = () => {
    problems.push(`${f.src}: failed to load`);
    console.warn(`[emberwild] tamer part missing: ${f.src}`);
    done("failed");
  };
  img.src = f.src;
}

/** Start loading every registered part (idempotent; called lazily on first use). */
export function preloadTamerParts(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  const errs = validateRegistry();
  if (errs.length) console.warn(`[emberwild] tamer appearance registry problems: ${errs.join("; ")}`);
  for (const f of assetFiles()) loadPart(f);
  ensureHdManifest();
}

/** Subscribe to part arrivals (the map repaints when sprites become available). */
export function onTamerLookReady(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function partOf(src: string): PartMap | null {
  const p = parts.get(src);
  return p && typeof p === "object" ? p.map : null;
}

/**
 * The composed 32×48 sprite for a look, or null while its body part is
 * still loading or unavailable (draw the fallback figure then). Invalid or
 * missing looks resolve to a safe registered look first.
 */
export function getLookSprite(raw: TamerLook | undefined | null): HTMLCanvasElement | null {
  preloadTamerParts();
  if (typeof document === "undefined") return null;
  const look = resolveLook(raw).look;
  const key = lookKey(look);
  const hd = getHDSprite(look, key);
  if (hd) return hd;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // refresh LRU order
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const c = composeLook(look, partOf);
  const bodyMissing = c.layer.every((l) => l !== "body");
  if (bodyMissing) {
    // still loading: don't cache a null while parts are in flight
    if (pending > 0) return null;
    cache.set(key, null);
    return null;
  }
  const cv = document.createElement("canvas");
  cv.width = SPRITE_W;
  cv.height = SPRITE_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(c.rgba), SPRITE_W, SPRITE_H), 0, 0);
  if (pending === 0) {
    cache.set(key, cv);
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  return cv;
}

/** Loader diagnostics (dev preview / console). */
export function tamerLookProblems(): readonly string[] {
  return problems;
}

/**
 * Area-average (box-filter) downscale of a composed sprite to an exact
 * device-pixel height. The map draws tamers at ~34–51 CSS px from a 192-px
 * source; with smoothing off that is nearest-neighbor DECIMATION at a
 * non-integer ratio — irregular row/column dropout that breaks outlines and
 * speckles highlights. Pre-filtering once into a cached canvas at the exact
 * target size keeps every feature present (softly averaged, never speckled),
 * and the actual blit then runs 1:1 with smoothing still off.
 */
function areaDownscale(im: HTMLCanvasElement, devH: number): HTMLCanvasElement | null {
  const srcCtx = im.getContext("2d");
  if (!srcCtx || devH < 4 || devH >= im.height) return null;
  const sw = im.width, sh = im.height;
  const dw = Math.max(1, Math.round((sw / sh) * devH));
  const src = srcCtx.getImageData(0, 0, sw, sh);
  const out = srcCtx.createImageData(dw, devH);
  const d = src.data, o = out.data;
  for (let y = 0; y < devH; y++) {
    const y0 = (y * sh) / devH, y1 = ((y + 1) * sh) / devH;
    for (let x = 0; x < dw; x++) {
      const x0 = (x * sw) / dw, x1 = ((x + 1) * sw) / dw;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          if (wx <= 0 || wy <= 0) continue;
          const si = (yy * sw + xx) * 4, wa = (d[si + 3] ? 1 : 0) * wx * wy;
          r += d[si] * wa; g += d[si + 1] * wa; b += d[si + 2] * wa; a += wa; n += wx * wy;
        }
      const oi = (y * dw + x) * 4;
      if (a > n * 0.5) {
        o[oi] = r / a; o[oi + 1] = g / a; o[oi + 2] = b / a; o[oi + 3] = 255;
      }
    }
  }
  const cv = document.createElement("canvas");
  cv.width = dw;
  cv.height = devH;
  cv.getContext("2d")?.putImageData(out, 0, 0);
  return cv;
}

/**
 * The composed look pre-filtered to `deviceH` device pixels for the map
 * draw (see areaDownscale). Falls back to the full-size sprite whenever a
 * pre-scale is not meaningful (loading, upsampling, degenerate sizes).
 */
export function getLookSpriteScaled(raw: TamerLook | undefined | null, deviceH: number): HTMLCanvasElement | null {
  const im = getLookSprite(raw);
  if (!im || deviceH < 4 || deviceH >= im.height) return im;
  const key = `${lookKey(resolveLook(raw).look)}@${deviceH}`;
  const hit = scaledCache.get(key);
  if (hit) return hit;
  const cv = areaDownscale(im, deviceH);
  if (!cv) return im;
  scaledCache.set(key, cv);
  while (scaledCache.size > SCALED_MAX) {
    const oldest = scaledCache.keys().next().value;
    if (oldest === undefined) break;
    scaledCache.delete(oldest);
  }
  return cv;
}
