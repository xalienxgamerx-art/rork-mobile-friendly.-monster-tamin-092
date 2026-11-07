import { DAY_TICKS, ITEMS } from "./data";
import { applyNeedDelta, profileFor } from "./needs";
import { clamp, hash01 } from "./rng";
import { isSettlement, settlementId, settlementSeed, settlementTier } from "./settlement";
import type { GoodId, GameState, SettlementEcon, SettlementProfile } from "./types";
import { type Feature, getWorld } from "./world";

/**
 * Settlement economies (Update E) — the concrete stores and coin behind the
 * needs heartbeat (needs.ts stays the lightweight layer the contract board
 * reads; this is where the granaries actually fill and empty):
 *
 *  - initialization is a pure function of world seed + settlement identity,
 *    so the same save always rebuilds the same starting stores;
 *  - one bounded daily step: the settlement's way of life produces and
 *    consumes, trade (trade.ts) moves surpluses between settlements, and
 *    shortage or abundance then nudges the needs via applyNeedDelta — the
 *    needs' own mean-reversion pulls the other way, so the two layers settle
 *    into a stable, legible equilibrium;
 *  - catch-up after absence is bounded (ECON_CATCHUP_DAYS), exactly like
 *    needs.ts; a settlement seen after a year converges in bounded steps;
 *  - everything is clamped: stores to [0, STOCK_CAP], coin to [0, TREASURY_CAP].
 *
 * Merchant pricing also lives here: one `merchantPrice` function, used by
 * the shop actions and the shop UI alike, so the buy button can never
 * disagree with the price paid.
 */

export const ECON_CATCHUP_DAYS = 40;
/** Stores clamp: no settlement hoards forever, none starves below empty. */
export const STOCK_CAP = 60;
/** Coin clamp: treasuries are flavor-scale, not player-scale. */
export const TREASURY_CAP = 600;
/** Max chebyshev reach of a trade route (trade.ts reads this). Neighboring settlements sit 100–280 apart. */
export const ROUTE_REACH = 280;

export const GOOD_KEYS: GoodId[] = ["food", "materials", "wares"];

/** Per-day production by way of life — the single tuning surface for what a settlement makes. */
export const YIELD: Record<SettlementProfile, Record<GoodId, number>> = {
  farming: { food: 5, materials: 1, wares: 0 },
  mining: { food: 1, materials: 5, wares: 0 },
  frontier: { food: 2, materials: 2, wares: 0 },
  market: { food: 0, materials: 0, wares: 5 },
};

/** Per-day consumption by way of life — mouths, workshops and customers. */
const EAT: Record<SettlementProfile, Record<GoodId, number>> = {
  farming: { food: 3, materials: 1, wares: 1 },
  mining: { food: 4, materials: 2, wares: 1 },
  frontier: { food: 3, materials: 1, wares: 0 },
  market: { food: 3, materials: 2, wares: 1 },
};

/** Which store an item belongs to when priced: ore for workshops, food for bellies, the rest wares. */
export function goodOfItem(itemId: string): GoodId {
  if (itemId === "ore") return "materials";
  if ((ITEMS[itemId as keyof typeof ITEMS]?.food ?? 0) > 0) return "food";
  return "wares";
}

/** Starting stores: shaped by the profile's own yields, plus a per-field jitter. */
function initEcon(gs: GameState, f: Feature): SettlementEcon {
  const profile = profileFor(gs.seed, f);
  const sseed = settlementSeed(gs.seed, f);
  const tier = settlementTier(f) ?? "hamlet";
  const base = (good: GoodId): number => {
    const v = Math.round((YIELD[profile][good] + EAT[profile][good]) * 3.2);
    const jitter = Math.round(hash01(sseed ^ 0x3c0, f.x + (good.length + 3) * 41, f.y) * 10) - 5;
    return clamp(v + jitter + (tier === "hamlet" ? -3 : 0), 4, STOCK_CAP);
  };
  const treasury = clamp(60 + Math.round(hash01(sseed ^ 0x70b5, f.x, f.y) * 80) + (tier === "city" ? 60 : tier === "town" ? 30 : 0), 10, TREASURY_CAP);
  return { food: base("food"), materials: base("materials"), wares: base("wares"), treasury, day: Math.floor(gs.tick / DAY_TICKS) };
}

/** One bounded daily economic step: produce, consume, a weather-of-the-day wobble. */
export function econStep(e: SettlementEcon, profile: SettlementProfile, sseed: number, fx: number, fy: number, day: number): void {
  for (let gi = 0; gi < GOOD_KEYS.length; gi++) {
    const g = GOOD_KEYS[gi];
    const wobble = Math.round(hash01(sseed ^ 0xab17, fx + day * 97 + gi * 53, fy - day * 31) * 3) - 1;
    const v = e[g] + YIELD[profile][g] - EAT[profile][g] + wobble;
    e[g] = clamp(v, 0, STOCK_CAP);
  }
  // a market town's selling fills its coffers; a starving one buys grain in
  const coin = e.treasury + (profile === "market" ? 2 : e.food >= 25 ? 1 : -2);
  e.treasury = clamp(coin, 0, TREASURY_CAP);
}

/** How store levels speak to the needs heartbeat: the economy's daily word. */
function speakToNeeds(gs: GameState, key: string, e: SettlementEcon): void {
  const say = (good: GoodId, field: "food" | "materials" | "trade", lowAt: number, highAt: number): void => {
    if (e[good] < lowAt) applyNeedDelta(gs, key, field, -1);
    else if (e[good] > highAt) applyNeedDelta(gs, key, field, 1);
  };
  say("food", "food", 10, 36);
  say("materials", "materials", 10, 36);
  say("wares", "trade", 8, 32);
  if (e.treasury <= 0) applyNeedDelta(gs, key, "prosperity", -1);
  else if (e.treasury >= TREASURY_CAP * 0.8) applyNeedDelta(gs, key, "prosperity", 1);
}

/**
 * The economy of one settlement, created and caught up lazily — the exact
 * lazy/bounded pattern needs.ts uses, so the two layers stay in step.
 */
export function econOf(gs: GameState, f: Feature): SettlementEcon {
  const all = (gs.economy ??= {});
  const key = settlementId(f);
  let e = all[key];
  if (!e) {
    e = initEcon(gs, f);
    all[key] = e;
    return e;
  }
  const today = Math.floor(gs.tick / DAY_TICKS);
  if (e.day < today) {
    const profile = profileFor(gs.seed, f);
    const sseed = settlementSeed(gs.seed, f);
    const steps = Math.min(today - e.day, ECON_CATCHUP_DAYS);
    for (let i = 0; i < steps; i++) econStep(e, profile, sseed, f.x, f.y, e.day + i);
    e.day = today;
    speakToNeeds(gs, key, e);
  }
  return e;
}

/** Read-only look at a settlement's stores (UI); never steps the clock. */
export function econPeek(gs: GameState, f: Feature): SettlementEcon | null {
  return gs.economy?.[settlementId(f)] ?? null;
}

/** Adds to one store (deliveries, events). Bounded, idempotent at the caller. */
export function addGood(gs: GameState, key: string, good: GoodId, n: number): void {
  const e = gs.economy?.[key];
  if (!e || !n) return;
  e[good] = clamp(e[good] + n, 0, STOCK_CAP);
}

/** Adds coin to a treasury. Bounded, idempotent at the caller. */
export function addTreasury(gs: GameState, key: string, n: number): void {
  const e = gs.economy?.[key];
  if (!e || !n) return;
  e.treasury = clamp(e.treasury + n, 0, TREASURY_CAP);
}

/* ------------------------------- merchant pricing ------------------------------ */

/**
 * The price one settlement's trader asks (mode "buy") or pays (mode "sell")
 * for an item — a pure function of its economy. Scarce goods cost more,
 * abundant goods cost less, a flush treasury haggles kindly. Deterministic:
 * the same save, settlement and stores always quote the same price.
 * Returns null when the settlement has no economy record yet (callers fall
 * back to the legacy fixed price).
 */
export function merchantPrice(gs: GameState, f: Feature, itemId: string, mode: "buy" | "sell"): number | null {
  const e = gs.economy?.[settlementId(f)];
  const def = ITEMS[itemId as keyof typeof ITEMS];
  const value = def?.value ?? 0;
  if (!e || !value) return null;
  const good = goodOfItem(itemId);
  const localYield = YIELD[profileFor(gs.seed, f)][good];
  // scarcity: every unit below the comfortable mark pushes the price up
  const scarce = Math.max(0, 26 - e[good]);
  let buyMul = 1.5 + scarce / 60 + (localYield === 0 ? 0.15 : 0) - (localYield >= 5 ? 0.2 : 0);
  if (e.treasury >= TREASURY_CAP * 0.7) buyMul -= 0.1;
  if (e.treasury <= 20) buyMul += 0.15; // hard times: the till is guarded
  // what the trader pays for your goods: fair, less when coin is short
  const sellMul = e.treasury <= 20 ? 0.7 : e.treasury >= TREASURY_CAP * 0.7 ? 1 : 0.85;
  return mode === "buy" ? Math.max(1, Math.round(value * buyMul)) : Math.max(1, Math.round(value * sellMul));
}

/** A word-portrait of a settlement's markets, for the trader's stall and the notice board. */
export function marketLine(gs: GameState, f: Feature): string | null {
  const e = gs.economy?.[settlementId(f)];
  if (!e) return null;
  const granary = e.food < 10 ? "The granaries are near empty" : e.food < 20 ? "The granaries run low" : e.food > 36 ? "The granaries are full" : "The granaries hold";
  const stalls = e.wares < 8 ? "the stalls are bare" : e.wares > 30 ? "the stalls overflow" : "the stalls are stocked";
  const coin = e.treasury <= 20 ? " Coin is scarce in town." : e.treasury >= TREASURY_CAP * 0.7 ? " Coin is easy in town." : "";
  return `${granary}, ${stalls}.${coin}`;
}

/** The settlement the player stands in (null in the wilds). */
export function settlementHere(gs: GameState): Feature | null {
  const site = getWorld(gs.seed).siteAt(gs.player.x, gs.player.y);
  const f = site?.feature;
  return f && isSettlement(f) ? f : null;
}
