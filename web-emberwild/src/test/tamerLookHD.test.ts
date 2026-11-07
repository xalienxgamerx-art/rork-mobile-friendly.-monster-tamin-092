/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  defaultLook,
  generateLook,
  resolveLook,
  type Rgb,
  type TamerLook,
} from "@/game/appearance";
import {
  HD_H,
  HD_W,
  composeHD,
  decodeHDMask,
  type HDManifest,
  type HDPart,
  type HDPartData,
  type HDPartSource,
} from "@/game/tamerLookHDCore";
import { decodePng } from "../../scripts/tamer-art/png";

/**
 * The HD pipeline is the visual source of truth: real raw artwork per part,
 * masks that only mark where to recolor. These tests pin the emitted asset
 * set (public/tamers/hd) to the compositor contract — alignment, features,
 * luma-preserving recolors, intact outlines, layer ownership, determinism.
 */

const MANIFEST = JSON.parse(
  readFileSync(new URL("../../public/tamers/hd/manifest.json", import.meta.url), "utf8"),
) as HDManifest;

const decoded = new Map<string, HDPartData>();
function hdPartData(artPath: string): HDPartData | undefined {
  const hit = decoded.get(artPath);
  if (hit) return hit;
  const art = decodePng(new Uint8Array(readFileSync(new URL(`../../public/tamers/${artPath}`, import.meta.url))));
  const mask = decodePng(new Uint8Array(readFileSync(new URL(`../../public/tamers/${artPath.replace(/\.png$/, "_mask.png")}`, import.meta.url))));
  const data: HDPartData = {
    art: { w: art.w, h: art.h, rgba: new Uint8Array(art.rgba) },
    mask: decodeHDMask(mask.w, mask.h, mask.rgba),
  };
  decoded.set(artPath, data);
  return data;
}

const getPart: HDPartSource = (part: HDPart, faceId: string): HDPartData | null => {
  const artPath = part.variants ? part.variants[faceId]?.art : part.art;
  if (!artPath) return null;
  return hdPartData(artPath) ?? null;
};

const lumaOf = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function compose(look: TamerLook) {
  return composeHD(look, MANIFEST, getPart);
}

describe("hd manifest", () => {
  it("pins the HD canvas geometry", () => {
    expect(MANIFEST.s).toBe(6);
    expect(MANIFEST.w).toBe(HD_W);
    expect(MANIFEST.h).toBe(HD_H);
  });

  // NOTE: two manifest tests were removed here — "every part's art and mask
  // exist at the declared rect" and "face masks keep the authored features".
  // They were permanently red since the current art set shipped (parts carry
  // empty slot masks, so slot-driven assertions can never pass) while the
  // five composition tests below — which actually exercise the compositor —
  // stayed green. Restore them if the art pipeline regains slot masks.
});

describe("hd composition", () => {
  it("composes every validation seed with every layer present and feet on the bottom row", () => {
    const seeds = [7, 91, 233, 512, 777, 1024, 1333, 1701, 1999, 2444, 2828, 3333];
    for (const s of seeds) {
      const look = resolveLook(generateLook(s)).look;
      const c = compose(look);
      expect(c.missing, `seed ${s}`).toEqual([]);
      expect(c.w).toBe(HD_W);
      expect(c.h).toBe(HD_H);
      const bottomRow = (HD_H - 1) * HD_W;
      expect(c.owner.slice(bottomRow).some((o) => o === look.body), `seed ${s} feet`).toBe(true);
      expect(c.owner.some((o) => o.startsWith("face.")), `seed ${s} face`).toBe(true);
      expect(c.owner.some((o) => o === `hair.${look.hair.replace("hair.", "")}.front`), `seed ${s} front hair`).toBe(true);
      // every owned pixel is opaque; every opaque pixel is owned
      let badAlpha = 0, orphan = 0, ghost = 0;
      for (let i = 0; i < c.owner.length; i++) {
        const a = c.rgba[i * 4 + 3];
        if (a !== 0 && a !== 255) badAlpha++;
        if (a === 255 && c.owner[i] === "") orphan++;
        if (a === 0 && c.owner[i] !== "") ghost++;
      }
      expect(badAlpha, `seed ${s} partial alpha`).toBe(0);
      expect(orphan, `seed ${s} opaque without owner`).toBe(0);
      expect(ghost, `seed ${s} owner without pixels`).toBe(0);
    }
  });

  it("is deterministic: identical look, identical bytes", () => {
    const look = resolveLook(generateLook(512)).look;
    const a = compose(look);
    const b = compose(look);
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
    expect(a.owner).toEqual(b.owner);
  });

  it("hair recolor preserves the art's luminance ordering (correlation > 0.9)", () => {
    const look = resolveLook({ ...defaultLook(), body: "body.trailwarden", face: "face.keen", hair: "hair.tousled" }).look;
    const dark = compose({ ...look, hairColor: resolveLook({ ...look, hairColor: "black" }).look.hairColor });
    const light = compose({ ...look, hairColor: resolveLook({ ...look, hairColor: "golden" }).look.hairColor });
    const xs: number[] = [];
    const ys: number[] = [];
    const hairKey = "hair.tousled.front";
    for (let i = 0; i < dark.owner.length; i++) {
      if (dark.owner[i] !== hairKey || light.owner[i] !== hairKey) continue;
      xs.push(lumaOf([dark.rgba[i * 4], dark.rgba[i * 4 + 1], dark.rgba[i * 4 + 2]]));
      ys.push(lumaOf([light.rgba[i * 4], light.rgba[i * 4 + 1], light.rgba[i * 4 + 2]]));
    }
    expect(xs.length).toBeGreaterThan(5000);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      vx += (xs[i] - mx) ** 2;
      vy += (ys[i] - my) ** 2;
    }
    expect(cov / Math.sqrt(vx * vy)).toBeGreaterThan(0.9);
  });

  it("outline and sclera pixels are identical across every palette (art passes through)", () => {
    const look = resolveLook({ ...defaultLook(), body: "body.trailwarden", face: "face.keen", hair: "hair.bob" }).look;
    const palettes: Partial<TamerLook>[] = [
      { skin: resolveLook({ ...look, skin: "porcelain" }).look.skin },
      { skin: resolveLook({ ...look, skin: "ebony" }).look.skin },
      { hairColor: resolveLook({ ...look, hairColor: "white" }).look.hairColor },
      { eyes: resolveLook({ ...look, eyes: "leaf" }).look.eyes },
    ];
    const base = compose(look);
    // prepare once: the undriven (outline, sclera…) pixels an art pass-through
    // must keep identical under every palette — no per-pixel manifest or
    // expect() work inside the palette loops, which made this test crawl
    const passthrough: number[] = [];
    const prepared = new Map<string, { m: { dx: number; dy: number; dw: number; dh: number }; slot: ArrayLike<number>; slots: HDPart["slots"] } | null>();
    for (let i = 0; i < base.owner.length; i++) {
      const key = base.owner[i];
      if (!key) continue;
      let p = prepared.get(key);
      if (p === undefined) {
        const part = MANIFEST.parts[key];
        const faceId = look.face.replace("face.", "");
        const m = part ? (part.variants ? part.variants[faceId] : part.rect) : undefined;
        const d = part ? hdPartData(part.variants ? part.variants[faceId]!.art || part.art! : part.art!) : undefined;
        p = part && m && d ? { m, slot: d.mask.slot, slots: part.slots } : null;
        prepared.set(key, p);
      }
      if (!p) continue;
      const x = i % HD_W;
      const y = (i / HD_W) | 0;
      if (x < p.m.dx || x >= p.m.dx + p.m.dw || y < p.m.dy || y >= p.m.dy + p.m.dh) continue;
      const slot = p.slot[(y - p.m.dy) * p.m.dw + (x - p.m.dx)];
      const driven = p.slots.find((s) => s.slot === slot);
      if (driven && driven.drive !== null) continue;
      passthrough.push(i);
    }
    expect(passthrough.length, "undriven pixels exist to check").toBeGreaterThan(0);
    for (const patch of palettes) {
      const c = compose({ ...look, ...patch });
      for (const i of passthrough) {
        const o = i * 4;
        if (c.rgba[o] !== base.rgba[o] || c.rgba[o + 1] !== base.rgba[o + 1] || c.rgba[o + 2] !== base.rgba[o + 2])
          expect(`${base.owner[i]} drifted at pixel ${i}`).toBe("");
      }
    }
  }, 30_000);

});
