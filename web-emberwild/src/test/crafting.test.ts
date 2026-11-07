import { describe, expect, it } from "vitest";

import { CRAFT_RECIPES, craftItem, experimentCraft, isKnownCraft } from "@/game/crafting";
import { ITEMS } from "@/game/data";
import { migrateLoaded } from "@/game/migrate";
import { statOf } from "@/game/monster";
import { newGame, previewStarter, useItemOn } from "@/game/sim";
import type { GameState, ItemId } from "@/game/types";

/**
 * Update B — crafting. Remedies, cures, combat brews and field supplies made
 * from foraged materials. Outputs are existing items with existing uses;
 * consumption is atomic; higher tiers are discovered by experimenting.
 */

const SEED = "PROVISIONS-3";
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

const give = (gs: GameState, item: ItemId, n: number): void => {
  gs.bag[item] = (gs.bag[item] ?? 0) + n;
};

describe("crafting recipes", () => {
  it("every recipe outputs an existing, functional item", () => {
    for (const r of CRAFT_RECIPES) {
      const out = ITEMS[r.output];
      expect(out, r.output).toBeDefined();
      // functional: heals, cures, or grants a battle status — nothing decorative
      expect(out.heal > 0 || out.cures.length > 0 || !!out.grants, r.output).toBe(true);
      for (const i of r.ingredients) expect(ITEMS[i], i).toBeDefined();
    }
  });

  it("tier I recipes are known from the start; stronger brews are not", () => {
    const gs = makeGs();
    for (const r of CRAFT_RECIPES) {
      expect(isKnownCraft(gs, r), r.id).toBe(r.tier === 1);
    }
  });
});

describe("craftItem", () => {
  it("brews a draught: consumes exactly the ingredients, produces the remedy", () => {
    const gs = makeGs();
    give(gs, "herb", 2);
    const out = craftItem(gs, "craft_draught");
    expect(out.ok).toBe(true);
    expect(gs.bag.herb).toBe(0);
    expect(gs.bag.draught).toBe(1);
  });

  it("consumption is atomic — a short recipe changes nothing", () => {
    const gs = makeGs();
    give(gs, "herb", 1); // draught needs two
    const out = craftItem(gs, "craft_draught");
    expect(out.ok).toBe(false);
    expect(gs.bag.herb).toBe(1);
    expect(gs.bag.draught ?? 0).toBe(0);
    expect(out.ticks).toBe(0);
  });

  it("refuses undiscovered recipes", () => {
    const gs = makeGs();
    give(gs, "ore", 1);
    give(gs, "garlic", 1);
    const out = craftItem(gs, "craft_ironbrew");
    expect(out.ok).toBe(false);
    expect(gs.bag.ore).toBe(1);
    expect(gs.bag.garlic).toBe(1);
  });
});

describe("experimentCraft", () => {
  it("discovers a higher-tier recipe when the multiset matches", () => {
    const gs = makeGs();
    give(gs, "ore", 1);
    give(gs, "garlic", 1);
    const out = experimentCraft(gs, ["ore", "garlic"]);
    expect(out.ok).toBe(true);
    expect(out.discovered).toBe("craft_ironbrew");
    expect(gs.crafting?.discovered["craft_ironbrew"]).toBe(1);
    expect(gs.bag.ironbrew).toBe(1);
  });

  it("a discovered recipe is then craftable directly", () => {
    const gs = makeGs();
    give(gs, "ore", 2);
    give(gs, "garlic", 2);
    experimentCraft(gs, ["ore", "garlic"]);
    expect(craftItem(gs, "craft_ironbrew").ok).toBe(true);
    expect(gs.bag.ironbrew).toBe(2);
  });

  it("a mismatch consumes the materials and discovers nothing", () => {
    const gs = makeGs();
    give(gs, "berries", 1);
    give(gs, "egg", 1);
    const out = experimentCraft(gs, ["berries", "egg"]);
    expect(out.ok).toBe(true);
    expect(out.discovered).toBeUndefined();
    expect(gs.bag.berries).toBe(0);
    expect(gs.bag.egg).toBe(0);
    expect(Object.keys(gs.crafting?.discovered ?? {}).length).toBe(0);
  });
});

describe("crafted remedies work through the existing item system", () => {
  it("a crafted greater tonic heals a wounded monster via useItemOn", () => {
    const gs = makeGs();
    const m = gs.party[0];
    m.hp = Math.max(1, m.hp - 50);
    const before = m.hp;
    give(gs, "greater_tonic", 1);
    const line = useItemOn(gs, m, "greater_tonic");
    expect(line).toMatch(/Greater Tonic/);
    expect(m.hp).toBe(Math.min(statOf(m, "hp"), before + 90)); // heals up to +90, clamped at max
    expect(m.hp).toBeGreaterThan(before);
    expect(gs.bag.greater_tonic ?? 0).toBe(0);
  });

  it("a crafted antidote cures poison through the same path", () => {
    const gs = makeGs();
    const m = gs.party[0];
    gs.fighters[m.uid] = { statuses: [{ id: "poisoned", turns: 5 }], cooldowns: {} };
    give(gs, "antidote", 1);
    useItemOn(gs, m, "antidote");
    expect(gs.fighters[m.uid].statuses.length).toBe(0);
  });
});

describe("crafting migration", () => {
  it("a v25 save gains an empty crafting ledger; discoveries persist forward", () => {
    const gs = makeGs();
    const saved = JSON.parse(JSON.stringify({ ...gs, version: 25 })) as GameState;
    delete (saved as { crafting?: unknown }).crafting;
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.crafting?.discovered).toEqual({});
    saved.crafting!.discovered["craft_ironbrew"] = 1;
    const again = JSON.parse(JSON.stringify(saved)) as GameState;
    expect(migrateLoaded(again)).toBe(true);
    expect(again.crafting?.discovered["craft_ironbrew"]).toBe(1);
  });
});
