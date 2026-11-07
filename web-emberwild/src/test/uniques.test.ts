/// <reference types="node" />
import { describe, expect, it } from "vitest";

import { CROSSBREED_ONLY, HYBRID_ALPHA_CHANCE, LEGENDARY_ROSTER, MAX_LEVEL, RECIPES, SKILLS, SPECIES, SPECIES_LIST } from "@/game/data";
import { SIG_MODS, evolutionChoices, resolveSignature } from "@/game/signature";

/**
 * Species-unique techniques: one signature-capable move per species, learned
 * at level 20 (the doorway to the deep ladder), known by nobody else. Beyond
 * it, every species climbs the shared element ladder to a level-100 finale.
 * Plus the crossbreed-only alpha rule: hybrids can claim a lair (rarely),
 * but never spawn otherwise.
 */

const uniqueOf = (s: { id: string; learnset: [number, string][] }): [number, string] => {
  const at20 = s.learnset.filter(([lv]) => lv === 20);
  expect(at20.length, `${s.id} has exactly one level-20 entry`).toBe(1);
  return at20[0];
};

describe("species-unique moves", () => {
  it("every species' final learnset entry is a real, level-100 skill", () => {
    for (const s of SPECIES_LIST) {
      const [level, skill] = s.learnset[s.learnset.length - 1];
      expect(level, `${s.id} final entry level`).toBe(MAX_LEVEL);
      expect(SKILLS[skill], `${s.id} final move ${skill}`).toBeDefined();
      // learnset stays ascending and every entry is a real skill
      for (let i = 1; i < s.learnset.length; i++) {
        expect(s.learnset[i][0]).toBeGreaterThanOrEqual(s.learnset[i - 1][0]);
        expect(SKILLS[s.learnset[i][1]], `${s.id} move ${s.learnset[i][1]}`).toBeDefined();
      }
    }
  });

  it("every species climbs to a deep ladder, not just its level-20 unique", () => {
    for (const s of SPECIES_LIST) {
      expect(s.learnset.length, `${s.id} learnset size`).toBeGreaterThanOrEqual(10);
      expect(s.learnset.some(([lv]) => lv >= 74), `${s.id} has a deep move`).toBe(true);
    }
  });

  it("every unique move is known by exactly one species", () => {
    const counts = new Map<string, string[]>();
    for (const s of SPECIES_LIST) {
      for (const [, skill] of s.learnset) {
        const holders = counts.get(skill) ?? [];
        holders.push(s.id);
        counts.set(skill, holders);
      }
    }
    for (const s of SPECIES_LIST) {
      const uniqueId = uniqueOf(s)[1];
      expect(counts.get(uniqueId), `${uniqueId} must be exclusive to ${s.id}`).toEqual([s.id]);
    }
  });

  it("every unique move can serve as a signature: evolution choices exist and mods resolve", () => {
    const sig = { uid: "sig:t", baseId: "", name: "", mods: [], gen: 0, history: [], nextLevel: 10, origin: "chosen" as const };
    for (const s of SPECIES_LIST) {
      const baseId = uniqueOf(s)[1];
      sig.baseId = baseId;
      const choices = evolutionChoices(sig);
      expect(choices.length, `${baseId} must offer evolution choices`).toBeGreaterThan(0);
      const resolved = resolveSignature(baseId, [choices[0].id]);
      expect(resolved.name).toBeTruthy();
      expect(resolved.desc).toContain(SKILLS[baseId].name);
    }
  });

  it("the brand-new modifiers are wired into the catalog with distinct mechanics", () => {
    for (const id of ["crushing", "savage_lunge", "drenching", "predators_instinct", "shrouding", "deep_drain"]) {
      expect(SIG_MODS[id], id).toBeDefined();
    }
    // savage_lunge only fits a dash move; deep_drain only a drain move
    const dashBase = resolveSignature("squall_dive", []);
    expect(SIG_MODS.savage_lunge.fits(dashBase)).toBe(true);
    const stillBase = resolveSignature("bite", []);
    expect(SIG_MODS.savage_lunge.fits(stillBase)).toBe(false);
    const drainBase = resolveSignature("reap", []);
    expect(SIG_MODS.deep_drain.fits(drainBase)).toBe(true);
    expect(SIG_MODS.deep_drain.fits(stillBase)).toBe(false);
  });
});

describe("crossbreed-only alphas", () => {
  it("CROSSBREED_ONLY is exactly the species with no wild biomes, all recipe outcomes", () => {
    const outcomes = new Set(RECIPES.map(([, , r]) => r));
    // the five legendary individuals (Update G) also have empty biome tables,
    // but they spawn through their own ladder — never through crossbreeding
    const emptyBiome = SPECIES_LIST.filter((s) => Object.keys(s.biomes).length === 0 && !LEGENDARY_ROSTER.includes(s.id)).map((s) => s.id);
    expect(CROSSBREED_ONLY.sort()).toEqual(emptyBiome.sort());
    for (const id of CROSSBREED_ONLY) {
      expect(outcomes.has(id), `${id} must be a recipe outcome`).toBe(true);
      expect(SPECIES[id].rarity === "rare" || SPECIES[id].rarity === "legendary").toBe(true);
    }
  });

  it("the alpha chance is small", () => {
    expect(HYBRID_ALPHA_CHANCE).toBeGreaterThan(0);
    expect(HYBRID_ALPHA_CHANCE).toBeLessThanOrEqual(0.05);
  });

  it("every hybrid has two distinct parents to draw a pack from", () => {
    for (const id of CROSSBREED_ONLY) {
      const recipe = RECIPES.find(([, , r]) => r === id);
      expect(recipe, `${id} recipe`).toBeDefined();
      expect(recipe![0]).not.toBe(recipe![1]);
    }
  });
});
