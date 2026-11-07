import type { GameState, ItemId } from "./types";

/**
 * Update B — the crafting system. Separate from cooking: remedies, cures,
 * combat prep brews and exploration supplies made from foraged materials.
 *
 * Outputs are existing items with existing uses (tonics heal and cure,
 * brews grant battle statuses) — crafting adds a way to make them, it never
 * repurposes or redefines them. No equipment or homestead recipes yet.
 *
 * Like cooking.ts this module is pure: no sim.ts import, actions return their
 * lines and tick costs for sim.ts to apply.
 */

/** Ticks a craft takes (2 ticks = 10 minutes of the sim clock). */
export const CRAFT_TICKS = 2;

export interface CraftRecipe {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  ingredients: ItemId[];
  output: ItemId;
}

export const CRAFT_RECIPES: CraftRecipe[] = [
  // Tier I — common knowledge, every herbalist's basics
  { id: "craft_draught", name: "Herbal Draught", tier: 1, ingredients: ["herb", "herb"], output: "draught" },
  { id: "craft_antidote", name: "Antidote", tier: 1, ingredients: ["herb", "mushroom"], output: "antidote" },
  { id: "craft_draught_big", name: "Hearth Tonic", tier: 1, ingredients: ["herb", "honeycomb"], output: "tonic" },
  // Tier II — field remedies
  { id: "craft_firebane", name: "Firebane Salve", tier: 2, ingredients: ["cactus_fruit", "herb"], output: "firebane" },
  { id: "craft_brighteye", name: "Brighteye Drops", tier: 2, ingredients: ["tomato", "mushroom"], output: "brighteye" },
  { id: "craft_warybrew", name: "Warybrew", tier: 2, ingredients: ["garlic", "herb"], output: "warybrew" },
  // Tier III — strong brews
  { id: "craft_windstep", name: "Windstep Brew", tier: 3, ingredients: ["carrot", "garlic", "mushroom"], output: "windstep" },
  { id: "craft_ironbrew", name: "Ironbrew", tier: 3, ingredients: ["ore", "garlic"], output: "ironbrew" },
  { id: "craft_greater_tonic", name: "Greater Tonic", tier: 3, ingredients: ["herb", "honeycomb", "mushroom"], output: "greater_tonic" },
];

/* --------------------------------- Lookups ---------------------------------- */

export function craftFor(item: ItemId): CraftRecipe | null {
  return CRAFT_RECIPES.find((r) => r.output === item) ?? null;
}

export function isKnownCraft(state: GameState, r: CraftRecipe): boolean {
  return r.tier === 1 || !!(state.crafting?.discovered[r.id]);
}

/* ---------------------------------- Crafting --------------------------------- */

export interface CraftOutcome {
  ok: boolean;
  lines: string[];
  discovered?: string;
  ticks: number;
}

function countIngredients(state: GameState, ings: ItemId[]): boolean {
  for (const i of ings) {
    let need = 0;
    for (const j of ings) if (j === i) need++;
    if ((state.bag[i] ?? 0) < need) return false;
  }
  return true;
}

function consumeIngredients(state: GameState, ings: ItemId[]): void {
  for (const i of ings) state.bag[i] = (state.bag[i] ?? 0) - 1;
}

/** Craft a known recipe. Pure: returns lines and a tick cost for sim.ts to apply. */
export function craftItem(state: GameState, recipeId: string): CraftOutcome {
  const r = CRAFT_RECIPES.find((x) => x.id === recipeId);
  if (!r) return { ok: false, lines: ["No such recipe."], ticks: 0 };
  if (!isKnownCraft(state, r)) return { ok: false, lines: ["You don't know that recipe yet."], ticks: 0 };
  if (!countIngredients(state, r.ingredients)) return { ok: false, lines: ["You're missing materials."], ticks: 0 };
  consumeIngredients(state, r.ingredients);
  state.bag[r.output] = (state.bag[r.output] ?? 0) + 1;
  return { ok: true, lines: [`${r.name} brewed and stoppered.`], ticks: CRAFT_TICKS };
}

/**
 * Experiment: combine 2–4 materials. A multiset matching a crafting recipe
 * brews it — discovering it first if unknown. Mismatches teach you the
 * ingredients were wrong, and cost themselves to the lesson.
 */
export function experimentCraft(state: GameState, picks: ItemId[]): CraftOutcome {
  if (picks.length < 1 || picks.length > 4) return { ok: false, lines: ["Pick one to four materials to work with."], ticks: 0 };
  if (!countIngredients(state, picks)) return { ok: false, lines: ["You don't have all of that."], ticks: 0 };
  const key = [...picks].sort().join("+");
  const r = CRAFT_RECIPES.find((x) => [...x.ingredients].sort().join("+") === key);
  if (!r) {
    consumeIngredients(state, picks);
    return { ok: true, lines: ["The mortar grinds, the mixture sulks. Not every lesson is a success."], ticks: CRAFT_TICKS };
  }
  const known = isKnownCraft(state, r);
  if (!known) {
    state.crafting = state.crafting ?? { discovered: {} };
    state.crafting.discovered[r.id] = 1;
  }
  consumeIngredients(state, picks);
  state.bag[r.output] = (state.bag[r.output] ?? 0) + 1;
  return {
    ok: true,
    lines: known ? [`${r.name} brewed and stoppered.`] : [`Experimenting pays off — you've discovered ${r.name}!`],
    discovered: known ? undefined : r.id,
    ticks: CRAFT_TICKS,
  };
}
