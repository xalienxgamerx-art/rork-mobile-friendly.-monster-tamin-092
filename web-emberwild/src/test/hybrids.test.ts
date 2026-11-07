/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { RECIPES, SPECIES, SPECIES_LIST, SKILLS, TRAITS } from "@/game/data";
import { offspringSpecies } from "@/game/breeding";
import type { Monster, TraitId } from "@/game/types";

/**
 * The six crossbreed-only hybrid lines: they exist ONLY as recipe outcomes —
 * no wild biome weight (pickSpecies can never roll them) and a recipe pairing
 * of two different species always yields the hybrid.
 */

const HYBRIDS = ["gravewool", "slagtoad", "rimefang", "wispwraith", "geodeback", "mawbrand"];

const parent = (speciesId: string, level = 8): Monster & { speciesId: string; level: number } =>
  ({
    speciesId,
    level,
    uid: `t-${speciesId}`,
    genes: {},
    skills: [],
    mutations: [],
    personality: "loyal",
    plus: 0,
    bond: 20,
  }) as unknown as Monster & { speciesId: string; level: number };

describe("hybrid species registry", () => {
  it("every hybrid exists, is rare or better, and has no wild biome anywhere", () => {
    for (const id of HYBRIDS) {
      const s = SPECIES[id];
      expect(s, id).toBeDefined();
      expect(["rare", "legendary"]).toContain(s.rarity);
      expect(Object.values(s.biomes).reduce((a, w) => a + (w ?? 0), 0), `${id} wild weight`).toBe(0);
      // every move is a real skill, every trait a real trait
      for (const [, skill] of s.learnset) expect(SKILLS[skill], `${id} move ${skill}`).toBeDefined();
      for (const t of s.traits) expect(TRAITS[t as TraitId], `${id} trait ${t}`).toBeDefined();
    }
    // 31 mundane/hybrid species + the nine one-of-a-kind legendaries (Updates G + G.3 + G.4)
    expect(SPECIES_LIST.length).toBe(40);
  });

  it("every hybrid is the recipe outcome of two different species, and no recipe references unknown species", () => {
    const hybridRecipes = RECIPES.filter(([, , r]) => HYBRIDS.includes(r));
    expect(hybridRecipes.map(([, , r]) => r).sort()).toEqual([...HYBRIDS].sort());
    for (const [x, y, r] of hybridRecipes) {
      expect(SPECIES[x], `${x} in ${r}`).toBeDefined();
      expect(SPECIES[y], `${y} in ${r}`).toBeDefined();
      expect(x, `${r} must come from two DIFFERENT species`).not.toBe(y);
    }
  });

  it("recipe pairing determines the hybrid in both parent orders; other pairs do not", () => {
    for (const [x, y, r] of RECIPES.filter(([, , r]) => HYBRIDS.includes(r))) {
      expect(offspringSpecies(parent(x), parent(y))).toBe(r);
      expect(offspringSpecies(parent(y), parent(x))).toBe(r);
      expect(offspringSpecies(parent(x), parent(x)), `same-species ${x} never yields ${r}`).not.toBe(r);
    }
    expect(offspringSpecies(parent("slimekin"), parent("mossback"))).not.toBe("geodeback");
  });
});
