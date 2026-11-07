import { beforeAll, describe, expect, it } from "vitest";

import { applyMealEffect, expireFoodEffects, mealEffect, recipeFor, TIER_DURATION } from "@/game/cooking";
import { DAY_TICKS } from "@/game/data";
import { statOf } from "@/game/monster";
import { migrateLoaded } from "@/game/migrate";
import { newGame, previewStarter } from "@/game/sim";
import type { GameState } from "@/game/types";

/**
 * Update B — food effects. One flat bonus per stat, refreshed by refeeding,
 * replaced only by stronger meals, expired on the simulation clock (never
 * real time), with safe HP handling when max HP changes.
 */

const SEED = "PROVISIONS-2";
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

// a cold newGame costs ~5s; warm the world once so no test eats it against the 5s default
beforeAll(() => makeGs(), 60_000);

/** First party monster. */
const lead = (gs: GameState) => gs.party[0];

describe("applyMealEffect", () => {
  it("raises the real combat stat, not a display stat", () => {
    const gs = makeGs();
    const m = lead(gs);
    const before = statOf(m, "atk", gs.tick);
    const line = applyMealEffect(m, "smoked_meat", gs.tick);
    expect(line).toBeTruthy();
    expect(statOf(m, "atk", gs.tick)).toBe(before + TIER1_ATK);
  });

  it("applies exactly one effect per stat — a second meal on the same stat replaces, never stacks", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "smoked_meat", gs.tick); // tier I atk +3
    applyMealEffect(m, "hunters_hotpot", gs.tick); // tier III atk +8
    expect(m.foodEffects?.atk?.amount).toBe(8);
    expect(Object.keys(m.foodEffects ?? {}).filter((k) => k === "atk").length).toBe(1);
  });

  it("a weaker meal never weakens a running effect", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "hunters_hotpot", gs.tick); // +8 atk
    const out = applyMealEffect(m, "smoked_meat", gs.tick); // +3 atk
    expect(out).toBeNull();
    expect(m.foodEffects?.atk?.amount).toBe(8);
  });

  it("an equal meal refreshes the duration without stacking", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "smoked_meat", gs.tick);
    const firstUntil = m.foodEffects?.atk?.until;
    expect(firstUntil).toBe(gs.tick + TIER_DURATION[1]);
    applyMealEffect(m, "smoked_meat", gs.tick + 10);
    expect(m.foodEffects?.atk?.amount).toBe(TIER1_ATK);
    expect(m.foodEffects?.atk?.until).toBe(gs.tick + 10 + TIER_DURATION[1]);
  });

  it("an expired effect can be re-applied at full strength", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "hunters_hotpot", gs.tick);
    // let it lapse
    gs.tick += TIER_DURATION[3] + 1;
    const out = applyMealEffect(m, "smoked_meat", gs.tick);
    expect(out).toBeTruthy();
    expect(m.foodEffects?.atk?.amount).toBe(3);
  });

  it("different stats coexist", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "smoked_meat", gs.tick);
    applyMealEffect(m, "roasted_fish", gs.tick);
    expect(m.foodEffects?.atk?.amount).toBe(3);
    expect(m.foodEffects?.agi?.amount).toBe(3);
  });

  it("raw (uncooked) foods carry no effect", () => {
    const gs = makeGs();
    const m = lead(gs);
    expect(applyMealEffect(m, "fish", gs.tick)).toBeNull();
    expect(applyMealEffect(m, "berries", gs.tick)).toBeNull();
    expect(m.foodEffects ?? {}).toEqual({});
  });
});

describe("expiry on the simulation clock", () => {
  it("effects expire by sim tick via advance(), never wall-clock", () => {
    const gs = makeGs();
    const m = lead(gs);
    const baseAtk = statOf(m, "atk", gs.tick);
    applyMealEffect(m, "smoked_meat", gs.tick);
    expect(statOf(m, "atk", gs.tick)).toBe(baseAtk + TIER1_ATK);
    gs.tick += TIER_DURATION[1]; // advance the clock past the effect
    expireFoodEffects(gs);
    expect(m.foodEffects?.atk).toBeUndefined();
    expect(statOf(m, "atk", gs.tick)).toBe(baseAtk);
  });

  it("combat reads are exact even before the next prune (tick-aware statOf)", () => {
    const gs = makeGs();
    const m = lead(gs);
    const baseAtk = statOf(m, "atk", gs.tick);
    applyMealEffect(m, "smoked_meat", gs.tick);
    gs.tick += TIER_DURATION[1] + 5; // expired but not yet pruned
    expect(statOf(m, "atk", gs.tick)).toBe(baseAtk);
  });

  it("pen monsters keep their effects and expire them too", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "soothing_porridge", gs.tick);
    // move the monster to the pen
    gs.pen.push(gs.party.splice(0, 1)[0]);
    expireFoodEffects(gs);
    expect(gs.pen[0].foodEffects?.wis?.amount).toBe(mealEffect(recipeFor("soothing_porridge")!).amount);
    gs.tick += TIER_DURATION[3] + 1;
    expireFoodEffects(gs);
    expect(gs.pen[0].foodEffects?.wis).toBeUndefined();
  });

  it("an expiring HP effect re-clamps current HP to the reduced max — no wound from dinner", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "roasted_veg", gs.tick); // +3 hp for a day
    const buffedMax = statOf(m, "hp", gs.tick);
    m.hp = buffedMax; // patched up to the buffed max
    gs.tick += TIER_DURATION[1] + 1;
    expireFoodEffects(gs);
    const plainMax = statOf(m, "hp", gs.tick);
    expect(plainMax).toBeLessThan(buffedMax);
    expect(m.hp).toBeLessThanOrEqual(plainMax);
  });

  it("a day of rest (many advance ticks) expires a tier I meal cleanly", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "trail_mix", gs.tick);
    // simulate the clock directly tick by tick through the pruner
    for (let i = 0; i < DAY_TICKS; i++) {
      gs.tick += 1;
      expireFoodEffects(gs);
    }
    expect(m.foodEffects?.wis ?? null).toBeNull();
  });
});

describe("persistence", () => {
  it("active food effects survive save/load migration", () => {
    const gs = makeGs();
    const m = lead(gs);
    applyMealEffect(m, "hearty_stew", gs.tick);
    const saved = JSON.parse(JSON.stringify({ ...gs, version: 25 })) as GameState;
    expect(migrateLoaded(saved)).toBe(true);
    const sm = saved.party.find((x) => x.uid === m.uid)!;
    expect(sm.foodEffects?.hp?.amount).toBe(mealEffect(recipeFor("hearty_stew")!).amount);
    expect(sm.foodEffects?.hp?.until).toBe(m.foodEffects?.hp?.until);
    expect(sm.foodEffects?.hp?.source).toBe("Hearty Stew");
  });
});

const TIER1_ATK = 3;
