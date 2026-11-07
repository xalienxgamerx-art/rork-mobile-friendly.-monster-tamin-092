import { describe, expect, it } from "vitest";

import { cliffBandTex, cliffConnectTex, cliffFrac, fallFoamTex, rapidsTex, slopeTex, stairsBandTex, waterfallTex } from "@/game/tiles";

const alphaAt = (cv: HTMLCanvasElement, x: number, y: number): number =>
  cv.getContext("2d")!.getImageData(x, y, 1, 1).data[3];

const anyAlphaInRow = (cv: HTMLCanvasElement, y: number): boolean => {
  const d = cv.getContext("2d")!.getImageData(0, y, cv.width, 1).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
};

const anyAlphaInCol = (cv: HTMLCanvasElement, x: number): boolean => {
  const d = cv.getContext("2d")!.getImageData(x, 0, 1, cv.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
};

const anyAlphaInRect = (cv: HTMLCanvasElement, x0: number, y0: number, w: number, h: number): boolean => {
  const d = cv.getContext("2d")!.getImageData(x0, y0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
};

const allClearInRect = (cv: HTMLCanvasElement, x0: number, y0: number, w: number, h: number): boolean => {
  const d = cv.getContext("2d")!.getImageData(x0, y0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
  return true;
};

const NONE = { n: 0, e: 0, s: 0, w: 0, ne: 0, se: 0, sw: 0, nw: 0 };

describe("connected cliff textures", () => {
  it("draws nothing when no neighbour stands higher", () => {
    expect(cliffConnectTex("moss", 0, NONE)).toBeNull();
  });

  it("cliffFrac widens the band with the drop", () => {
    expect(cliffFrac(1)).toBeCloseTo(0.46);
    expect(cliffFrac(2)).toBeCloseTo(0.63);
    expect(cliffFrac(6)).toBe(0.96);
  });

  it("a north drop bands the top edge and leaves the tile's heart open", () => {
    const cv = cliffConnectTex("moss", 0, { ...NONE, n: 1 })!;
    const S = cv.width;
    expect(alphaAt(cv, S >> 1, Math.round(S * 0.15))).toBeGreaterThan(0);
    expect(alphaAt(cv, S >> 1, Math.round(S * 0.75))).toBe(0);
  });

  it("every orientation bands its own edge from the same art", () => {
    const S = cliffConnectTex("moss", 0, { ...NONE, e: 1 })!.width;
    // sample a small patch through each band's middle, away from the mitred
    // corners — fractions of S so the procedural 16s and the HD 32s both fit
    const patch = (fx0: number, fy0: number): [number, number, number, number] =>
      [Math.round(S * fx0), Math.round(S * fy0), Math.round(S * 0.18), Math.round(S * 0.1)];
    for (const side of ["n", "e", "s", "w"] as const) {
      const [x, y, w, h] =
        side === "n" ? patch(0.4, 0.08) : side === "s" ? patch(0.4, 0.82) : side === "e" ? patch(0.82, 0.4) : patch(0.08, 0.4);
      // the ground patch sits deep in the interior, opposite the band
      const [gx, gy] =
        side === "n" ? patch(0.35, 0.62) : side === "s" ? patch(0.35, 0.08) : side === "e" ? patch(0.08, 0.35) : patch(0.62, 0.35);
      const cv = cliffConnectTex("granite", 0, { ...NONE, [side]: 1 })!;
      expect(anyAlphaInRect(cv, x, y, w, h), `${side} band covers its edge`).toBe(true);
      expect(allClearInRect(cv, gx, gy, w, h), `${side} interior stays ground`).toBe(true);
    }
  });

  it("an outer corner wraps both walls and rounds the very corner point", () => {
    const cv = cliffConnectTex("basalt", 0, { ...NONE, n: 1, e: 1, ne: 1 })!;
    const S = cv.width;
    // both arms of the L carry wall art
    expect(anyAlphaInRect(cv, Math.round(S * 0.4), Math.round(S * 0.08), Math.round(S * 0.2), Math.round(S * 0.12)), "top arm").toBe(true);
    expect(anyAlphaInRect(cv, Math.round(S * 0.82), Math.round(S * 0.4), Math.round(S * 0.12), Math.round(S * 0.2)), "right arm").toBe(true);
    // the corner pixel itself is rounded off by the wrapping wall
    expect(alphaAt(cv, S - 1, 0), "NE corner rounded").toBe(0);
    // the far corner stays ground
    expect(alphaAt(cv, 0, S - 1)).toBe(0);
  });

  it("an inner corner joins two walls squarely where the plateau does not turn", () => {
    const cv = cliffConnectTex("basalt", 0, { ...NONE, n: 1, e: 1 })!;
    const S = cv.width;
    expect(anyAlphaInRect(cv, Math.round(S * 0.4), Math.round(S * 0.08), Math.round(S * 0.2), Math.round(S * 0.12)), "top arm").toBe(true);
    expect(anyAlphaInRect(cv, Math.round(S * 0.82), Math.round(S * 0.4), Math.round(S * 0.12), Math.round(S * 0.2)), "right arm").toBe(true);
    // the two wall runs meet: the shared corner region is wall
    expect(anyAlphaInRect(cv, Math.round(S * 0.86), Math.round(S * 0.05), Math.round(S * 0.08), Math.round(S * 0.08)), "NE join filled").toBe(true);
    expect(alphaAt(cv, S >> 1, S >> 1), "centre open").toBe(0);
  });

  it("two corner pairs layer elbows over full-length bands — no cross-hatch, no gaps", () => {
    const cv = cliffConnectTex("granite", 0, { ...NONE, n: 1, e: 1, s: 1 })!;
    const S = cv.width;
    // the old full-frame corner art cross-hatched: with two pairs the tile
    // centre was painted twice — it must stay open ground
    expect(alphaAt(cv, S >> 1, S >> 1), "centre stays ground").toBe(0);
    // every banded side keeps its band the full way, even where corner art
    // sits at an elbow — art is never trusted to fill a side alone (gaps bug)
    expect(alphaAt(cv, Math.round(S * 0.25), Math.round(S * 0.15)), "top band west of elbow").toBeGreaterThan(0);
    expect(alphaAt(cv, Math.round(S * 0.25), Math.round(S * 0.85)), "bottom band").toBeGreaterThan(0);
    expect(alphaAt(cv, Math.round(S * 0.85), Math.round(S * 0.5)), "right band between elbows").toBeGreaterThan(0);
    // both elbows carry their join art
    expect(anyAlphaInRect(cv, Math.round(S * 0.86), Math.round(S * 0.05), Math.round(S * 0.08), Math.round(S * 0.08)), "NE elbow").toBe(true);
    expect(anyAlphaInRect(cv, Math.round(S * 0.86), Math.round(S * 0.87), Math.round(S * 0.08), Math.round(S * 0.08)), "SE elbow").toBe(true);
  });

  it("a diagonal-only ledge still juts a corner nub of rock", () => {
    const cv = cliffConnectTex("ice", 0, { ...NONE, ne: 1 })!;
    const S = cv.width;
    expect(
      anyAlphaInRect(cv, Math.round(S * 0.72), Math.round(S * 0.06), Math.round(S * 0.2), Math.round(S * 0.16)),
      "NE nub present",
    ).toBe(true);
    expect(alphaAt(cv, S >> 1, S >> 1), "centre open").toBe(0);
    expect(allClearInRect(cv, 0, Math.round(S * 0.8), Math.round(S * 0.2), Math.round(S * 0.2)), "far corner open").toBe(true);
  });

  it("stairs and banks band the side that climbs", () => {
    for (const side of ["n", "e", "s", "w"] as const) {
      const stairs = stairsBandTex("sand", side, 0.44);
      const S = stairs.width;
      const m = S >> 1;
      const spots = {
        n: [m, Math.round(S * 0.15)],
        s: [m, S - Math.round(S * 0.15)],
        e: [S - Math.round(S * 0.15), m],
        w: [Math.round(S * 0.15), m],
      } as const;
      const [x, y] = spots[side];
      expect(alphaAt(stairs, x, y), `stairs ${side}`).toBeGreaterThan(0);
      const bank = cliffBandTex("earth", 0, side, 0.26);
      expect(alphaAt(bank, x, y), `bank ${side}`).toBeGreaterThan(0);
    }
  });

  it("water flows: rapids turn with the current, foam never fills the stream", () => {
    const n = rapidsTex("n");
    const e = rapidsTex("e");
    const S = n.width;
    expect(S).toBeGreaterThan(0);
    expect(rapidsTex("n")).toBe(n);
    // the chute points the way the water goes
    expect(e.toDataURL()).not.toBe(n.toDataURL());
    // foam streaks run along the flow: columns carry spray, and the overlay
    // stays translucent so the river shows through
    expect(anyAlphaInCol(n, S >> 1)).toBe(true);
    expect(alphaAt(n, S >> 1, S >> 1)).toBeLessThan(255);
  });

  it("a fall hangs on the water side of the face, with churn in the pool", () => {
    const f1 = waterfallTex("n", 1);
    const f2 = waterfallTex("n", 2);
    const S = f1.width;
    // deeper drop, longer curtain
    expect(f2.toDataURL()).not.toBe(f1.toDataURL());
    // one-level drop: the curtain covers the top band, the foot of the tile
    // stays rock
    expect(anyAlphaInRect(f1, 0, 0, S, Math.round(S * 0.4)), "curtain present").toBe(true);
    expect(allClearInRect(f1, 0, Math.round(S * 0.6), S, Math.round(S * 0.35)), "foot stays rock").toBe(true);
    // turned to face the drop
    expect(waterfallTex("e", 1).toDataURL()).not.toBe(f1.toDataURL());
    // splash foam hugs the edge it comes down and opens into the pool
    const foam = fallFoamTex("n");
    expect(anyAlphaInRow(foam, 2), "churn at the lip").toBe(true);
    expect(allClearInRect(foam, 0, Math.round(S * 0.7), S, Math.round(S * 0.3)), "pool open").toBe(true);
  });

  it("slope art turns with the climb and caches", () => {
    const n = slopeTex("moss", "n");
    const e = slopeTex("moss", "e");
    const S = n.width;
    expect(S).toBeGreaterThan(0);
    expect(slopeTex("moss", "n")).toBe(n);
    // a quarter turn points the climb east instead of north
    expect(e.toDataURL()).not.toBe(n.toDataURL());
    // a slope is solid ground: art or fallback alike covers the tile
    expect(alphaAt(n, S >> 1, S >> 1)).toBe(255);
  });
});
