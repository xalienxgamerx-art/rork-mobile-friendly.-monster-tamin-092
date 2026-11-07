import { beforeAll, describe, expect, it } from "vitest";

import {
  COOK_RECIPES,
  COOK_TICKS,
  MIN_FEED_COOLDOWN,
  ROAST_TICKS,
  TIER_BUFF,
  TIER_CD_MULT,
  FAVORITE_CD_MULT,
  TIER_DURATION,
  cookDish,
  equipmentForMethod,
  experimentCook,
  feedCooldownFor,
  isFavoriteMeal,
  isKnownRecipe,
  mealEffect,
  methodUnlocked,
  migrateProvisions,
  ownEquipment,
  recipeFor,
} from "@/game/cooking";
import { ITEMS, SPECIES } from "@/game/data";
import { migrateLoaded } from "@/game/migrate";
import { newGame, offerFood, previewStarter, SAVE_VERSION, useItemOn } from "@/game/sim";
import type { GameState, ItemId } from "@/game/types";
import { seedFromText } from "@/game/world";

/**
 * Update B — cooking. Four methods (roast always, grill/stew/bake via camp
 * gear), recipe tiers I–IV discovered by experimentation, and camp equipment
 * that persists. Pure-module rules: deterministic outputs, sim-clock costs.
 */

const SEED = "PROVISIONS-1";
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

// a cold newGame costs ~5s; warm the world once so no test eats it against the 5s default
beforeAll(() => makeGs(), 60_000);

const give = (gs: GameState, item: ItemId, n: number): void => {
  gs.bag[item] = (gs.bag[item] ?? 0) + n;
};

/* --------------------------------- Migration --------------------------------- */

describe("provisions migration (v26)", () => {
  it("backfills empty ledgers on a v25-shaped save", () => {
    const gs = makeGs();
    // simulate a v25 save: no provision state at all
    const saved = JSON.parse(JSON.stringify({ ...gs, version: 25 })) as GameState;
    delete (saved as { cooking?: unknown }).cooking;
    delete (saved as { crafting?: unknown }).crafting;
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.version).toBe(SAVE_VERSION);
    expect(saved.cooking?.discovered).toEqual({});
    expect(saved.cooking?.equipment).toEqual({});
    expect(saved.crafting?.discovered).toEqual({});
  });

  it("preserves existing ledgers and is idempotent", () => {
    const gs = makeGs();
    migrateProvisions(gs);
    gs.cooking!.discovered["grill_skewers"] = 1;
    gs.cooking!.equipment!.skillet = 1;
    const saved = JSON.parse(JSON.stringify(gs)) as GameState;
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.cooking?.discovered["grill_skewers"]).toBe(1);
    expect(saved.cooking?.equipment?.skillet).toBe(1);
    // re-running changes nothing
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.cooking?.discovered["grill_skewers"]).toBe(1);
  });
});

/* ------------------------------ Recipes & tiers ------------------------------- */

describe("recipe knowledge", () => {
  it("every recipe output is a real item with a diet and a stat effect", () => {
    for (const r of COOK_RECIPES) {
      const out = ITEMS[r.output];
      expect(out, r.output).toBeDefined();
      expect(out.diets.length).toBeGreaterThan(0);
      const fx = mealEffect(r);
      expect(fx.amount).toBe(TIER_BUFF[r.tier]);
      expect(fx.duration).toBe(TIER_DURATION[r.tier]);
      // ingredients are real, edible items
      for (const i of r.ingredients) expect(ITEMS[i]?.food ?? 0, i).toBeGreaterThan(0);
    }
  });

  it("tier I recipes are known from the start; higher tiers are not", () => {
    const gs = makeGs();
    for (const r of COOK_RECIPES) {
      expect(isKnownRecipe(gs, r), r.id).toBe(r.tier === 1);
    }
  });

  it("every species favorite food appears in some recipe (cooked favorites exist)", () => {
    const ings = new Set(COOK_RECIPES.flatMap((r) => r.ingredients));
    // the raw favorites except ore (a lithovore's taste — no cooking that)
    for (const fav of ["meat", "honeycomb", "fish", "berries", "mushroom", "nuts", "roasted_nuts"] as ItemId[]) {
      expect(ings.has(fav), fav).toBe(true);
    }
  });
});

/* --------------------------------- Cooking ----------------------------------- */

describe("cookDish", () => {
  it("roasts a fish: consumes the ingredient, produces the meal, costs roast time", () => {
    const gs = makeGs();
    give(gs, "fish", 1);
    const out = cookDish(gs, "roast_fish");
    expect(out.ok).toBe(true);
    expect(out.ticks).toBe(ROAST_TICKS);
    expect(gs.bag.fish).toBe(0);
    expect(gs.bag.roasted_fish).toBe(1);
  });

  it("stewing costs more time than roasting", () => {
    const gs = makeGs();
    // know the recipe and own the pot
    gs.cooking = { discovered: { stew_heart: 1 }, equipment: {} };
    ownEquipment(gs, "cooking_pot");
    give(gs, "meat", 1);
    give(gs, "potato", 1);
    give(gs, "carrot", 1);
    give(gs, "onion", 1);
    const out = cookDish(gs, "stew_heart");
    expect(out.ok).toBe(true);
    expect(out.ticks).toBe(COOK_TICKS);
    expect(out.ticks).toBeGreaterThan(ROAST_TICKS);
    expect(gs.bag.hearty_stew).toBe(1);
  });

  it("refuses unknown recipes, missing gear and missing ingredients — consuming nothing", () => {
    const gs = makeGs();
    gs.bag.meat = 0;
    gs.bag.onion = 0;
    give(gs, "meat", 1);
    give(gs, "onion", 1);
    // tier II is undiscovered
    expect(cookDish(gs, "grill_skewers").ok).toBe(false);
    expect(gs.bag.meat).toBe(1);
    // discovered but the skillet is missing
    gs.cooking = { discovered: { grill_skewers: 1 }, equipment: {} };
    expect(cookDish(gs, "grill_skewers").ok).toBe(false);
    expect(gs.bag.meat).toBe(1);
    ownEquipment(gs, "skillet");
    // now only the ingredients are missing
    gs.bag.meat = 0;
    const out = cookDish(gs, "grill_skewers");
    expect(out.ok).toBe(false);
    expect(gs.bag.onion).toBe(1);
    expect(out.ticks).toBe(0);
  });
});

/* --------------------------------- Equipment --------------------------------- */

describe("camp equipment", () => {
  it("roasting is always unlocked; gear unlocks only its own method", () => {
    const gs = makeGs();
    expect(methodUnlocked(gs, "roast")).toBe(true);
    expect(methodUnlocked(gs, "grill")).toBe(false);
    expect(methodUnlocked(gs, "stew")).toBe(false);
    expect(methodUnlocked(gs, "bake")).toBe(false);
    ownEquipment(gs, "skillet");
    expect(methodUnlocked(gs, "grill")).toBe(true);
    expect(methodUnlocked(gs, "stew")).toBe(false);
    ownEquipment(gs, "portable_oven");
    expect(methodUnlocked(gs, "bake")).toBe(true);
    expect(methodUnlocked(gs, "stew")).toBe(false);
  });

  it("each method maps to exactly one equipment piece", () => {
    expect(equipmentForMethod("roast")).toBeNull();
    expect(equipmentForMethod("grill")).toBe("skillet");
    expect(equipmentForMethod("stew")).toBe("cooking_pot");
    expect(equipmentForMethod("bake")).toBe("portable_oven");
  });
});

/* -------------------------------- Discovery ---------------------------------- */

describe("experimentCook", () => {
  it("discovers an unknown recipe when the ingredient multiset matches", () => {
    const gs = makeGs();
    ownEquipment(gs, "skillet"); // grill_skewers needs the gear too
    gs.bag.meat = 0;
    gs.bag.onion = 0;
    give(gs, "meat", 1);
    give(gs, "onion", 1);
    const out = experimentCook(gs, ["meat", "onion"]);
    expect(out.ok).toBe(true);
    expect(out.discovered).toBe("grill_skewers");
    expect(gs.cooking?.discovered["grill_skewers"]).toBe(1);
    expect(gs.bag.grilled_skewers).toBe(1);
    expect(gs.bag.meat).toBe(0);
  });

  it("matching a known recipe just cooks it (no discovery event)", () => {
    const gs = makeGs();
    give(gs, "fish", 1);
    const out = experimentCook(gs, ["fish"]);
    expect(out.ok).toBe(true);
    expect(out.discovered).toBeUndefined();
    expect(gs.bag.roasted_fish).toBe(1);
  });

  it("a mismatch consumes the ingredients and produces nothing", () => {
    const gs = makeGs();
    give(gs, "nuts", 1);
    give(gs, "garlic", 1);
    const before = JSON.stringify(gs.bag);
    const out = experimentCook(gs, ["nuts", "garlic"]);
    expect(out.ok).toBe(true);
    expect(out.lines.join(" ")).toMatch(/mush/i);
    expect(JSON.parse(JSON.stringify(gs.bag))).not.toEqual(JSON.parse(before));
    expect(gs.bag.nuts).toBe(0);
    expect(gs.bag.garlic).toBe(0);
    expect(Object.keys(gs.cooking?.discovered ?? {}).length).toBe(0);
  });

  it("refuses impossible picks (5 ingredients, duplicates beyond the bag)", () => {
    const gs = makeGs();
    give(gs, "herb", 1);
    const five = ["herb", "herb", "herb", "herb", "herb"] as ItemId[];
    expect(experimentCook(gs, five).ok).toBe(false);
    // only one herb in the bag — a two-herb pick fails on stock
    expect(experimentCook(gs, ["herb", "herb"]).ok).toBe(false);
    // a single ingredient is allowed; it matches nothing and feeds the fire
    const solo = experimentCook(gs, ["herb"]);
    expect(solo.ok).toBe(true);
    expect(gs.bag.herb).toBe(0);
  });
});

/* --------------------------- Cooked favorite foods ----------------------------- */

describe("cooked favorites", () => {
  it("a meal containing the raw favorite is recognized as a favorite", () => {
    expect(isFavoriteMeal("meat", "hearty_stew")).toBe(true);
    expect(isFavoriteMeal("meat", "soothing_porridge")).toBe(false);
    expect(isFavoriteMeal("nuts", "trail_mix")).toBe(true);
    expect(isFavoriteMeal("roasted_nuts", "nut_loaf")).toBe(true);
    expect(isFavoriteMeal(undefined, "hearty_stew")).toBe(false);
  });

  it("favorite recognition matches the raw favorite itself", () => {
    expect(isFavoriteMeal("meat", "meat")).toBe(false); // raw handling stays in the feed code path
  });
});

/* ---------------------------- Feeding cooldowns ------------------------------- */

describe("feedCooldownFor", () => {
  it("a raw favorite shortens the cooldown on its own; plain raw food does not", () => {
    expect(feedCooldownFor("fish", 36, false)).toBe(36);
    expect(feedCooldownFor("fish", 36, true)).toBe(Math.round(36 * FAVORITE_CD_MULT));
  });

  it("cooked food shortens the cooldown by tier, on top of the favorite bonus", () => {
    expect(feedCooldownFor("roasted_fish", 36, false)).toBe(Math.round(36 * TIER_CD_MULT[1]));
    expect(feedCooldownFor("roasted_fish", 36, true)).toBe(Math.round(36 * TIER_CD_MULT[1] * FAVORITE_CD_MULT));
    expect(feedCooldownFor("hearty_stew", 36, true)).toBe(Math.round(36 * TIER_CD_MULT[3] * FAVORITE_CD_MULT));
    // every step down the ladder is a real reduction
    expect(feedCooldownFor("fish", 36, true)).toBeLessThan(36);
    expect(feedCooldownFor("roasted_fish", 36, true)).toBeLessThan(feedCooldownFor("fish", 36, true));
    expect(feedCooldownFor("hearty_stew", 36, true)).toBeLessThan(feedCooldownFor("roasted_fish", 36, true));
    expect(feedCooldownFor("wanderers_feast", 36, true)).toBeLessThan(feedCooldownFor("hearty_stew", 36, true));
  });

  it("never drops below the floor, even for a tier IV favorite", () => {
    expect(feedCooldownFor("wanderers_feast", 36, true)).toBeGreaterThanOrEqual(MIN_FEED_COOLDOWN);
    expect(feedCooldownFor("wanderers_feast", 6, true)).toBe(MIN_FEED_COOLDOWN);
  });

  it("higher tiers never cool down longer than the raw food", () => {
    for (const id of COOK_RECIPES.map((r) => r.output)) {
      expect(feedCooldownFor(id, 36, false)).toBeLessThanOrEqual(36);
      expect(feedCooldownFor(id, 36, true)).toBeLessThanOrEqual(feedCooldownFor(id, 36, false));
      expect(feedCooldownFor(id, 36, false)).toBeGreaterThanOrEqual(MIN_FEED_COOLDOWN);
    }
  });
});

/* ------------------------- Wild feeding (offerFood) ---------------------------- */

describe("wild feeding integration (offerFood)", () => {
  it("a cooked favorite gains the same affection as the raw favorite, but cools down faster", () => {
    const base = makeGs();
    // a calm, packless creature whose species loves berries (raw + cooked favorite test)
    const id = Object.values(base.creatures).find(
      (c) => SPECIES[c.speciesId].likes === "berries" && c.disposition !== "aggressive" && !c.pack && !c.alpha,
    )?.id;
    expect(id).toBeTruthy();
    if (!id) return;
    // probe for a tick where the feed doesn't backfire (same seed+tick+geneSeed
    // → the same roll for both variants, so one good tick serves both)
    let okTick: number | null = null;
    for (let t = 100; t < 200 && okTick === null; t++) {
      const probe = JSON.parse(JSON.stringify(base)) as GameState;
      probe.tick = t;
      give(probe, "berries", 1);
      const r = offerFood(probe, id, "berries");
      if (!r.engaged && probe.creatures[id]?.affection > 0) okTick = t;
    }
    expect(okTick).toBeTruthy();
    if (okTick === null) return;
    const raw = JSON.parse(JSON.stringify(base)) as GameState;
    const cooked = JSON.parse(JSON.stringify(base)) as GameState;
    raw.tick = okTick;
    cooked.tick = okTick;
    give(raw, "berries", 1);
    give(cooked, "soothing_porridge", 1);
    const rRaw = offerFood(raw, id, "berries");
    const rCooked = offerFood(cooked, id, "soothing_porridge");
    expect(rRaw.engaged).toBeUndefined();
    expect(rCooked.engaged).toBeUndefined();
    const aRaw = raw.creatures[id];
    const aCooked = cooked.creatures[id];
    expect(aRaw && aCooked).toBeTruthy();
    if (!aRaw || !aCooked) return;
    expect(aCooked.affection).toBe(aRaw.affection); // same taming progress, never more
    // the raw favorite already cools down faster than the standard wait; the
    // cooked meal cuts it further by tier (advance() spent 1 tick by the read)
    expect(aRaw.feedUntil - raw.tick).toBe(Math.round(36 * FAVORITE_CD_MULT) - 1);
    expect(aCooked.feedUntil - cooked.tick).toBe(Math.round(36 * TIER_CD_MULT[3] * FAVORITE_CD_MULT) - 1);
    expect(aCooked.feedUntil - cooked.tick).toBeLessThan(aRaw.feedUntil - raw.tick);
  });
});

/* ------------------------------ Lookup safety --------------------------------- */

describe("feeding integration (useItemOn)", () => {
  it("a cooked favorite bonds exactly like the raw favorite, never more", () => {
    const a = makeGs(); // raw favorite (mossback likes berries)
    give(a, "berries", 1);
    useItemOn(a, a.party[0], "berries");
    const b = makeGs(); // cooked favorite: soothing porridge contains berries
    give(b, "honeycomb", 1);
    give(b, "berries", 1);
    give(b, "soothing_porridge", 1);
    useItemOn(b, b.party[0], "soothing_porridge");
    expect(b.party[0].bond).toBe(a.party[0].bond);
    expect(b.party[0].bond).toBeGreaterThan(0);
  });

  it("a cooked meal fills more, applies its effect, and is consumed", () => {
    const gs = makeGs();
    give(gs, "honeycomb", 1);
    give(gs, "berries", 1);
    gs.bag.soothing_porridge = 1;
    const m = gs.party[0];
    m.satiety = 10;
    useItemOn(gs, m, "soothing_porridge");
    expect(gs.bag.soothing_porridge).toBe(0);
    expect(m.satiety).toBe(60); // 10 + 50 food
    expect(m.foodEffects?.wis?.amount).toBe(TIER_BUFF[3]);
  });

  it("a wrong-diet nibble grants no food effect", () => {
    const gs = makeGs(); // the starter mossback is an herbivore
    give(gs, "smoked_meat", 1); // a carnivore/omnivore meal
    const m = gs.party[0];
    const line = useItemOn(gs, m, "smoked_meat");
    expect(line).toMatch(/nibbles/);
    expect(m.foodEffects ?? {}).toEqual({});
  });
});

describe("recipeFor", () => {
  it("finds meals by output and returns null for raw items", () => {
    expect(recipeFor("hearty_stew")?.id).toBe("stew_heart");
    expect(recipeFor("fish")).toBeNull();
    expect(recipeFor("skillet")).toBeNull();
  });
});
