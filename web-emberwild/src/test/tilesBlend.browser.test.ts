import { describe, expect, it } from "vitest";

import { biomeTex, biomeTexBlended, HD_FADE } from "@/game/tiles";
import type { BiomeId } from "@/game/types";

const px = (cv: HTMLCanvasElement, x: number, y: number): number[] => {
  const ctx = cv.getContext("2d")!;
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
};

const same = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]) <= 1);

describe("hd edge blending", () => {
  const N: BiomeId = "meadow";
  const E: BiomeId = "mountain";

  it("keeps the ground identical when no different neighbour lends an edge", () => {
    const plain = biomeTex(N, 0);
    const S = plain.width;
    const blended = biomeTexBlended(N, 0, null, null, { biome: N, variant: 2 }, null);
    for (const [x, y] of [[0, 0], [S >> 1, 3], [S - 1, S - 1], [5, 20]]) {
      expect(same(px(blended, x, y), px(plain, x, y)), `${x},${y}`).toBe(true);
    }
  });

  it("a different north neighbour owns the top edge and fades out by the fade depth", () => {
    const plain = biomeTex(N, 0);
    const ground = biomeTex(E, 0);
    const S = plain.width;
    const F = Math.round((HD_FADE / 32) * S);
    const blended = biomeTexBlended(N, 0, { biome: E, variant: 0 }, null, null, null);
    // on the shared edge the neighbour's art is fully opaque — its wrap-around
    // row, exactly what tiles against the row of its we border
    expect(same(px(blended, S >> 1, 0), px(ground, S >> 1, 0))).toBe(true);
    expect(same(px(blended, 3, 0), px(ground, 3, 0))).toBe(true);
    // deep inside the tile our own ground is untouched
    expect(same(px(blended, S >> 1, F + 2), px(plain, S >> 1, F + 2))).toBe(true);
    expect(same(px(blended, S >> 1, S - 1), px(plain, S >> 1, S - 1))).toBe(true);
    // mid-fade the pixels sit between the two grounds (the blend actually happens)
    const mid = px(blended, S >> 1, F >> 1);
    const ours = px(plain, S >> 1, F >> 1);
    const theirs = px(ground, S >> 1, F >> 1);
    const between = mid.every((v, i) => v >= Math.min(ours[i], theirs[i]) - 1 && v <= Math.max(ours[i], theirs[i]) + 1);
    expect(between, "mid-fade pixel interpolates the two grounds").toBe(true);
  });

  it("blends all four edges independently, opposite neighbours meeting in the middle", () => {
    const blended = biomeTexBlended(N, 0, { biome: E, variant: 0 }, { biome: E, variant: 0 }, { biome: E, variant: 0 }, { biome: E, variant: 0 });
    const plain = biomeTex(N, 0);
    const ground = biomeTex(E, 0);
    const S = plain.width;
    const m = S >> 1;
    expect(same(px(blended, m, 0), px(ground, m, 0))).toBe(true);
    expect(same(px(blended, m, S - 1), px(ground, m, S - 1))).toBe(true);
    expect(same(px(blended, 0, m), px(ground, 0, m))).toBe(true);
    expect(same(px(blended, S - 1, m), px(ground, S - 1, m))).toBe(true);
    // the centre strip stays our ground between the two fades
    expect(same(px(blended, m, m), px(plain, m, m))).toBe(true);
  });

  it("caches blends per biome, variant and neighbour combination", () => {
    const a = biomeTexBlended(N, 0, { biome: E, variant: 0 }, null, null, null);
    const b = biomeTexBlended(N, 0, { biome: E, variant: 0 }, null, null, null);
    expect(b).toBe(a);
    const other = biomeTexBlended(N, 0, { biome: E, variant: 1 }, null, null, null);
    expect(other).not.toBe(a);
  });
});
