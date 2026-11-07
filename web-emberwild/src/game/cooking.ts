import { ITEMS } from "./data";
import { statOf } from "./monster";
import type { EquipId, GameState, ItemId, Monster, StatKey } from "./types";;

/**
 * Update B — Provisions and Production: the cooking system.
 *
 * Cooking is camp-based (no homestead required) and runs through four methods:
 *   roast  — always available at the campfire (roasted_nuts behavior untouched)
 *   grill  — unlocked by owning the Iron Skillet
 *   stew   — unlocked by owning the Cooking Pot
 *   bake   — unlocked by the Portable Oven
 *
 * Recipes come in tiers I–IV. Tier I recipes are known from the start; higher
 * tiers are discovered by experimenting with ingredients. Every cooked meal
 * carries ONE temporary stat effect that expires on the simulation clock.
 *
 * This module is pure: it never imports sim.ts (sim imports it), and actions
 * return their log lines so sim.ts can addLog + advance on their behalf.
 */

/* ------------------------------ Balance config ------------------------------ */

/** Tier → flat stat bonus the meal's food effect grants. */
export const TIER_BUFF: Record<1 | 2 | 3 | 4, number> = { 1: 3, 2: 5, 3: 8, 4: 12 };
/** Tier → effect duration in simulation ticks (288 ticks = one day). */
export const TIER_DURATION: Record<1 | 2 | 3 | 4, number> = { 1: 288, 2: 432, 3: 576, 4: 864 };
/**
 * Tier → multiplier on the wild feeding cooldown for that meal: a well-cooked
 * favorite keeps a beast satisfied far longer. Kept above MIN_FEED_COOLDOWN.
 */
export const TIER_CD_MULT: Record<1 | 2 | 3 | 4, number> = { 1: 0.9, 2: 0.8, 3: 0.65, 4: 0.5 };
/** A creature's favorite food (raw or cooked) shortens the feeding cooldown on its own. */
export const FAVORITE_CD_MULT = 0.75;
/** Never let feeding cooldowns drop below this (about one hour). */
export const MIN_FEED_COOLDOWN = 12;
/** Ticks a dish takes to cook (4 ticks = 20 minutes of the sim clock). */
export const COOK_TICKS = 4;
/** Roasting is the quick default. */
export const ROAST_TICKS = 2;

export const STAT_LABEL: Record<StatKey, string> = { hp: "HP", atk: "ATK", def: "DEF", agi: "AGI", wis: "WIS" };

/* --------------------------------- Recipes ---------------------------------- */

export type CookMethod = "roast" | "grill" | "stew" | "bake";

export interface CookRecipe {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  method: CookMethod;
  ingredients: ItemId[];
  output: ItemId;
  /** Which stat the meal's food effect boosts. */
  stat: StatKey;
}

/** The method each piece of camp equipment unlocks. */
export const EQUIP_METHOD: Record<EquipId, CookMethod> = { skillet: "grill", cooking_pot: "stew", portable_oven: "bake" };
export const EQUIPMENT_IDS: EquipId[] = ["skillet", "cooking_pot", "portable_oven"];
export const METHOD_LABEL: Record<CookMethod, string> = { roast: "Roasting", grill: "Grilling", stew: "Stewing", bake: "Baking" };

export const COOK_RECIPES: CookRecipe[] = [
  // Tier I — the campfire default, known from the start
  { id: "roast_fish", name: "Roasted Fish", tier: 1, method: "roast", ingredients: ["fish"], output: "roasted_fish", stat: "agi" },
  { id: "roast_veg", name: "Roasted Vegetables", tier: 1, method: "roast", ingredients: ["carrot", "tomato"], output: "roasted_veg", stat: "hp" },
  { id: "smoke_meat", name: "Smoked Meat", tier: 1, method: "roast", ingredients: ["meat"], output: "smoked_meat", stat: "atk" },
  { id: "roast_trailmix", name: "Nutty Trail Mix", tier: 1, method: "roast", ingredients: ["nuts", "berries"], output: "trail_mix", stat: "wis" },
  { id: "roast_nutloaf", name: "Smoked Nut Loaf", tier: 2, method: "roast", ingredients: ["roasted_nuts", "mushroom"], output: "nut_loaf", stat: "def" },
  // Tier II — the skillet's grill
  { id: "grill_skewers", name: "Grilled Skewers", tier: 2, method: "grill", ingredients: ["meat", "onion"], output: "grilled_skewers", stat: "atk" },
  { id: "grill_steak", name: "Garlic-Seared Steak", tier: 2, method: "grill", ingredients: ["fish", "garlic"], output: "garlic_steak", stat: "agi" },
  { id: "grill_roots", name: "Charred Root Skewers", tier: 2, method: "grill", ingredients: ["potato", "onion", "garlic"], output: "charred_roots", stat: "def" },
  // Tier III — the pot's stews
  { id: "stew_heart", name: "Hearty Stew", tier: 3, method: "stew", ingredients: ["meat", "potato", "carrot", "onion"], output: "hearty_stew", stat: "hp" },
  { id: "stew_hunter", name: "Hunter's Hotpot", tier: 3, method: "stew", ingredients: ["meat", "mushroom", "garlic"], output: "hunters_hotpot", stat: "atk" },
  { id: "stew_porridge", name: "Soothing Porridge", tier: 3, method: "stew", ingredients: ["honeycomb", "berries"], output: "soothing_porridge", stat: "wis" },
  // Tier IV — the oven's baking
  { id: "bake_tart", name: "Golden Honey Tart", tier: 4, method: "bake", ingredients: ["honeycomb", "egg", "berries"], output: "honey_tart", stat: "agi" },
  { id: "bake_dragonbread", name: "Dragonbread", tier: 4, method: "bake", ingredients: ["garlic", "herb", "mushroom", "potato"], output: "dragonbread", stat: "def" },
  { id: "bake_feast", name: "Wanderer's Feast", tier: 4, method: "bake", ingredients: ["meat", "fish", "honeycomb", "tomato"], output: "wanderers_feast", stat: "hp" },
];

/* --------------------------------- Lookups ---------------------------------- */

/** The cooking recipe that produces a meal, if any. */
export function recipeFor(item: ItemId): CookRecipe | null {
  return COOK_RECIPES.find((r) => r.output === item) ?? null;
}

/** The food effect a meal grants: one stat, tier-scaled amount and duration. */
export function mealEffect(r: CookRecipe): { stat: StatKey; amount: number; duration: number } {
  return { stat: r.stat, amount: TIER_BUFF[r.tier], duration: TIER_DURATION[r.tier] };
}

/**
 * A cooked meal counts as the species' favorite when the raw favorite food is
 * among its ingredients — a stew full of roasted nuts pleases a nut-lover just
 * as much as the nuts themselves, never more (affection math stays identical).
 */
export function isFavoriteMeal(likes: ItemId | undefined, item: ItemId): boolean {
  if (!likes) return false;
  const r = recipeFor(item);
  return !!r && r.ingredients.includes(likes);
}

/**
 * Feeding cooldown for an item fed to a wild creature: a favorite food (raw or
 * cooked) shortens the wait on its own, cooked meals shorten it further by
 * recipe tier, and the result never drops below MIN_FEED_COOLDOWN. `base` is
 * the game's standard cooldown in ticks (passed in to avoid a sim.ts import).
 */
export function feedCooldownFor(item: ItemId, base: number, favorite: boolean): number {
  const r = recipeFor(item);
  const tierMult = r ? TIER_CD_MULT[r.tier] : 1;
  const favMult = favorite ? FAVORITE_CD_MULT : 1;
  return Math.max(MIN_FEED_COOLDOWN, Math.round(base * tierMult * favMult));
}

/* ------------------------------ Food effects -------------------------------- */

/**
 * Apply a meal's food effect to a monster. One effect per stat:
 *  - equal or stronger meals refresh (and may strengthen) the effect;
 *  - weaker meals are politely refused — an effect is never weakened by food.
 * Returns a log line, or null when nothing changed.
 */
export function applyMealEffect(mon: Monster, item: ItemId, tick: number): string | null {
  const r = recipeFor(item);
  if (!r) return null;
  const { stat, amount, duration } = mealEffect(r);
  mon.foodEffects = mon.foodEffects ?? {};
  const cur = mon.foodEffects[stat];
  if (cur && cur.until > tick && cur.amount > amount) return null; // stronger effect already running
  const until = tick + duration;
  const refreshed = !!cur && cur.until > tick;
  mon.foodEffects[stat] = { amount, until, source: ITEMS[item].name };
  return refreshed
    ? `The meal refreshes its ${STAT_LABEL[stat]} vigor. (+${amount} ${STAT_LABEL[stat]}, lasting a while longer)`
    : `The meal settles in well. (+${amount} ${STAT_LABEL[stat]} for ${Math.round(duration / 288 * 10) / 10} days)`;
}

/**
 * Expire food effects whose sim tick has passed. Prunes party and pen after
 * every tick; dropping an HP effect re-clamps current HP to the new max so a
 * fading feast never leaves a monster wounded by its own dinner.
 */
export function expireFoodEffects(state: GameState): void {
  for (const mon of [...state.party, ...state.pen]) {
    const fx = mon.foodEffects;
    if (!fx) continue;
    let droppedHp = false;
    for (const k of Object.keys(fx) as StatKey[]) {
      const e = fx[k];
      if (e && e.until <= state.tick) {
        if (k === "hp") droppedHp = true;
        delete fx[k];
      }
    }
    // the HP effect is already deleted, so statOf reads the reduced max
    if (droppedHp) mon.hp = Math.min(mon.hp, Math.max(1, statOf(mon, "hp", state.tick)));
  }
}

/* -------------------------------- Equipment --------------------------------- */

export function equipmentOf(state: GameState): Record<string, 1> {
  return state.cooking?.equipment ?? {};
}

export function hasEquipment(state: GameState, id: EquipId): boolean {
  return !!equipmentOf(state)[id];
}

/** True when `method` is usable with the equipment the player owns. */
export function methodUnlocked(state: GameState, method: CookMethod): boolean {
  if (method === "roast") return true;
  return EQUIPMENT_IDS.some((id) => EQUIP_METHOD[id] === method && hasEquipment(state, id));
}

/** The equipment piece that unlocks a method (null for roasting). */
export function equipmentForMethod(method: CookMethod): EquipId | null {
  return EQUIPMENT_IDS.find((id) => EQUIP_METHOD[id] === method) ?? null;
}

/** Is this item one of the three camp equipment pieces? */
export function isCampEquipment(item: ItemId): item is EquipId & ItemId {
  return (EQUIPMENT_IDS as string[]).includes(item);
}

/** Record a newly bought piece of camp gear (never touches the bag). */
export function ownEquipment(state: GameState, id: EquipId): string {
  state.cooking = state.cooking ?? { discovered: {} };
  state.cooking.equipment = state.cooking.equipment ?? {};
  state.cooking.equipment[id] = 1;
  return `${ITEMS[id].name} set up at your camp. ${METHOD_LABEL[EQUIP_METHOD[id]]} unlocked.`;
}

/* ------------------------------ Recipe knowledge ----------------------------- */

/** Tier I recipes are common knowledge; the rest must be discovered. */
export function isKnownRecipe(state: GameState, r: CookRecipe): boolean {
  return r.tier === 1 || !!(state.cooking?.discovered[r.id]);
}

/* ---------------------------------- Cooking ---------------------------------- */

export interface CookOutcome {
  ok: boolean;
  lines: string[];
  /** A newly discovered recipe id, if this cook found one. */
  discovered?: string;
  /** Ticks the work consumed (sim.ts advances the clock). */
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

/** Cook a known recipe. Pure: returns lines and a tick cost for sim.ts to apply. */
export function cookDish(state: GameState, recipeId: string): CookOutcome {
  const r = COOK_RECIPES.find((x) => x.id === recipeId);
  if (!r) return { ok: false, lines: ["No such dish."], ticks: 0 };
  if (!isKnownRecipe(state, r)) return { ok: false, lines: ["You don't know that recipe yet."], ticks: 0 };
  if (!methodUnlocked(state, r.method)) {
    const eq = equipmentForMethod(r.method);
    return { ok: false, lines: [eq ? `You need the ${ITEMS[eq].name} for ${METHOD_LABEL[r.method].toLowerCase()}.` : `You can't ${METHOD_LABEL[r.method].toLowerCase()} here.`], ticks: 0 };
  }
  if (!countIngredients(state, r.ingredients)) return { ok: false, lines: ["You're missing ingredients."], ticks: 0 };
  consumeIngredients(state, r.ingredients);
  state.bag[r.output] = (state.bag[r.output] ?? 0) + 1;
  return { ok: true, lines: [`${r.name} is ready. It smells wonderful.`], ticks: r.method === "roast" ? ROAST_TICKS : COOK_TICKS };
}

/**
 * Experiment: feed 2–4 ingredients to the fire. A multiset matching any
 * cooking recipe cooks it — discovering it first if it was unknown. Anything
 * else burns into mush; the ingredients are the price of learning.
 */
export function experimentCook(state: GameState, picks: ItemId[]): CookOutcome {
  if (picks.length < 1 || picks.length > 4) return { ok: false, lines: ["Pick one to four ingredients to cook."], ticks: 0 };
  if (!countIngredients(state, picks)) return { ok: false, lines: ["You don't have all of that."], ticks: 0 };
  const key = [...picks].sort().join("+");
  const r = COOK_RECIPES.find((x) => [...x.ingredients].sort().join("+") === key);
  if (!r) {
    consumeIngredients(state, picks);
    return { ok: true, lines: ["You cook the lot into gray, honest mush. Edible, educational, forgettable."], ticks: COOK_TICKS };
  }
  const known = isKnownRecipe(state, r);
  if (!methodUnlocked(state, r.method)) {
    return { ok: false, lines: [`The shape of it wants ${METHOD_LABEL[r.method].toLowerCase()} — you'd need the right camp gear.`], ticks: 0 };
  }
  if (!known) {
    state.cooking = state.cooking ?? { discovered: {} };
    state.cooking.discovered[r.id] = 1;
  }
  consumeIngredients(state, picks);
  state.bag[r.output] = (state.bag[r.output] ?? 0) + 1;
  return {
    ok: true,
    lines: known ? [`${r.name} is ready. It smells wonderful.`] : [`Experimenting pays off — you've discovered ${r.name}!`],
    discovered: known ? undefined : r.id,
    ticks: r.method === "roast" ? ROAST_TICKS : COOK_TICKS,
  };
}

/* --------------------------------- Migration --------------------------------- */

/**
 * v26: cooking and crafting ledgers. Backfilled empty — tier I recipes are
 * known by rule, equipment is bought in play, food effects ride on the
 * monsters themselves. Idempotent, runs on every load.
 */
export function migrateProvisions(state: GameState): void {
  state.cooking = state.cooking ?? { discovered: {}, equipment: {} };
  state.cooking.equipment = state.cooking.equipment ?? {};
  state.crafting = state.crafting ?? { discovered: {} };
}
