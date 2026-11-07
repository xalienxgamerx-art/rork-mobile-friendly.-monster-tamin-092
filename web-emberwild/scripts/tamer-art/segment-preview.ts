/** One-off QA for the pass-3 restructure: full-body sheet + head close-up registration grid. */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png";
import { composeHD, decodeHDMask, type HDManifest, type HDPartData } from "../../src/game/tamerLookHDCore";
import type { TamerLook } from "../../src/game/appearance";

const base = new URL("../../../web-emberwild/public/tamers/", import.meta.url);
const M: HDManifest = JSON.parse(readFileSync(new URL("hd/manifest.json", base), "utf8"));

const parts = new Map<string, HDPartData>();
const getPart = (part: any, faceId: string): HDPartData | null => {
  const p = part.variants ? part.variants[faceId] : part;
  if (!p?.art) return null;
  if (!parts.has(p.art)) {
    const art = decodePng(new Uint8Array(readFileSync(new URL(p.art, base))));
    const m = decodePng(new Uint8Array(readFileSync(new URL(p.mask, base))));
    parts.set(p.art, { art: { w: art.w, h: art.h, rgba: art.rgba }, mask: decodeHDMask(m.w, m.h, m.rgba) });
  }
  return parts.get(p.art) ?? null;
};

const compose = (look: any) => {
  const r = composeHD(look, M, getPart);
  if (r.missing.length) throw new Error(r.missing.join("; "));
  return { w: r.w, h: r.h, rgba: new Uint8ClampedArray(r.rgba) };
};

const out = (name: string, w: number, h: number, sheet: Uint8Array) =>
  writeFileSync(new URL(name, import.meta.url), encodePng(w, h, sheet));

// ── head close-up registration grid: 4 bodies × 4 faces × 2 expressions ─────
// face rect {dx:300,dy:136,dw:169,dh:176}; crop a generous head box around it.
const CX = 384, CY = 224, CR = 130; // head crop box
const cell = 2 * CR + 20, gap = 12;
const bodies = ["trailwarden", "brawler", "wayfarer", "scout"];
const faces = ["stern", "easy", "bright", "keen"];
const exprs = ["neutral", "grin"];
const gw = exprs.length * (cell + gap) + gap;
const gh = (bodies.length * faces.length) * (cell + gap) + gap;
const grid = new Uint8Array(gw * gh * 4);
let row = 0;
for (const b of bodies) {
  for (const f of faces) {
    let col = 0;
    for (const e of exprs) {
      const c = compose({
        body: `body.${b}`, face: `face.${f}`, expression: e, hair: "hair.crop", hairColor: "brown", skin: "tan", eyes: "brown",
        outfit: { dress: "navy", capelet: "red", belt: "brown", boots: "brown" },
      });
      const ox = gap + col * (cell + gap), oy = gap + row * (cell + gap);
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const sx = CX - CR + Math.floor(((x - 10) / (cell - 20)) * 2 * CR);
          const sy = CY - CR + Math.floor(((y - 10) / (cell - 20)) * 2 * CR);
          if (sx < 0 || sy < 0 || sx >= c.w || sy >= c.h) continue;
          const s = (sy * c.w + sx) * 4, o = ((oy + y) * gw + ox + x) * 4;
          const a = c.rgba[s + 3];
          grid[o] = Math.round((c.rgba[s] * a + 240 * (255 - a)) / 255);
          grid[o + 1] = Math.round((c.rgba[s + 1] * a + 240 * (255 - a)) / 255);
          grid[o + 2] = Math.round((c.rgba[s + 2] * a + 240 * (255 - a)) / 255);
          grid[o + 3] = 255;
        }
      }
      col++;
    }
    row++;
  }
}
out("segment_heads.png", gw, gh, grid);

// ── full-body sheet: 4 looks + rival reference ──────────────────────────────
const looks: TamerLook[] = [
  { body: "body.wayfarer", face: "face.easy", expression: "neutral", hair: "hair.braid", hairColor: "blond", skin: "tan", eyes: "blue", outfit: { capelet: "red", dress: "navy", belt: "brown", leggings: "indigo", boots: "brown" } },
  { body: "body.trailwarden", face: "face.stern", expression: "grin", hair: "hair.shag", hairColor: "auburn", skin: "deep", eyes: "brown", outfit: { coat: "green", shirt: "cream", belt: "brown", trousers: "brown", boots: "dark" } },
  { body: "body.brawler", face: "face.bright", expression: "neutral", hair: "hair.mane", hairColor: "white", skin: "olive", eyes: "green", outfit: { vest: "teal", wraps: "cream", sash: "red", trousers: "brown", shoes: "dark" } },
  { body: "body.scout", face: "face.keen", expression: "grin", hair: "hair.bob", hairColor: "black", skin: "tan", eyes: "blue", outfit: { tunic: "plum", shirt: "cream", belt: "brown", leggings: "forest", boots: "brown" } },
] as any[];
const composed = looks.map(compose);
const rival = decodePng(new Uint8Array(readFileSync(new URL("../../../web-emberwild/public/tamers/rival_1.png", import.meta.url))));
const scale = 0.16;
const dw = Math.round(768 * scale), dh = Math.round(1152 * scale);
const sw = composed.length * dw + 8 * (composed.length + 2), sh = dh + 16;
const sheet = new Uint8Array(sw * sh * 4);
let x = 8;
const blit = (im: { w: number; h: number; rgba: ArrayLike<number> }, ox: number, oy: number, w2: number, h2: number) => {
  for (let y = 0; y < h2; y++) {
    const sy = Math.min(im.h - 1, Math.floor((y * im.h) / h2));
    for (let xx = 0; xx < w2; xx++) {
      const sx = Math.min(im.w - 1, Math.floor((xx * im.w) / w2));
      const s = (sy * im.w + sx) * 4, o = ((oy + y) * sw + ox + xx) * 4;
      if (im.rgba[s + 3] < 10) continue;
      sheet[o] = im.rgba[s]; sheet[o + 1] = im.rgba[s + 1]; sheet[o + 2] = im.rgba[s + 2]; sheet[o + 3] = 255;
    }
  }
};
for (const c of composed) { blit(c, x, 8, dw, dh); x += dw + 8; }
blit(rival, x, 8, Math.round(rival.w * (dh / rival.h)), dh);
out("segment_bodies.png", sw, sh, sheet);
console.log("wrote segment_heads.png and segment_bodies.png");
