import { DAY_TICKS } from "./data";
import { GOOD_KEYS, ROUTE_REACH, addGood, addTreasury, econOf } from "./economy";
import { clamp } from "./rng";
import { isSettlement, settlementId } from "./settlement";
import type { GameState, GoodId, RouteState } from "./types";
import { type Feature, getWorld } from "./world";

/**
 * Regional trade (Update E) — how one settlement's surplus becomes another's
 * relief. Routes are derived, not simulated bodies: a settlement's partners
 * are its nearest neighbors within ROUTE_REACH, a pure function of the seed.
 * What persists per route is only its condition (bounded, lazily created,
 * pruned when stale) — a disrupted road heals by slow daily drift, and while
 * it is open it moves a few units of the good one side has and the other
 * lacks, coin following the goods. Caravans are never simulated: the transfer
 * is abstract, exactly like the distant-world population fold.
 */

/** Daily road-repair drift (points/day toward 100). */
const RECOVERY_RATE = 3;
/** A route below this condition moves no goods. */
export const ROUTE_MIN = 35;
/** Units moved per transfer. */
const FLOW = 3;
/** Coin per unit that changes hands. */
const COIN_PER_UNIT = 2;
/** Route records untouched this many days are pruned. */
const ROUTE_STALE_DAYS = 12;
/** Catch-up work per route is bounded to this many simulated days. */
const ROUTE_CATCHUP_DAYS = 20;

/** Canonical route key — symmetric in its endpoints, sorted for stability. */
export function routeKeyBetween(aKey: string, bKey: string): string {
  return aKey < bKey ? `r:${aKey}|${bKey}` : `r:${bKey}|${aKey}`;
}

/** A settlement's trade partners: its nearest settlements in reach, nearest first. */
export function partnersOf(gs: GameState, f: Feature): Feature[] {
  return getWorld(gs.seed)
    .featuresNear(f.x, f.y, ROUTE_REACH)
    .filter((x) => isSettlement(x) && (x.x !== f.x || x.y !== f.y))
    .sort((a, b) => Math.max(Math.abs(a.x - f.x), Math.abs(a.y - f.y)) - Math.max(Math.abs(b.x - f.x), Math.abs(b.y - f.y)) || a.x - b.x || a.y - b.y)
    .slice(0, 3);
}

/** The route condition between two settlement keys, created lazily, repaired by drift. */
export function routeOf(gs: GameState, aKey: string, bKey: string): RouteState {
  const all = (gs.routes ??= {});
  const key = routeKeyBetween(aKey, bKey);
  let r = all[key];
  if (!r) {
    r = { cond: 100, day: Math.floor(gs.tick / DAY_TICKS) };
    all[key] = r;
    return r;
  }
  const today = Math.floor(gs.tick / DAY_TICKS);
  if (r.day < today) {
    const steps = Math.min(today - r.day, ROUTE_CATCHUP_DAYS);
    for (let i = 0; i < steps; i++) r.cond = clamp(r.cond + RECOVERY_RATE, 0, 100);
    r.day = today;
  }
  return r;
}

/** Reads a route without stepping it (UI). */
export function routePeek(gs: GameState, aKey: string, bKey: string): RouteState | null {
  return gs.routes?.[routeKeyBetween(aKey, bKey)] ?? null;
}

/** A disruption cuts a route. Bounded, idempotent at the caller (guard ids live with the caller). */
export function disruptRoute(gs: GameState, aKey: string, bKey: string, amount: number): void {
  if (!amount) return;
  const r = routeOf(gs, aKey, bKey);
  r.cond = clamp(r.cond - amount, 0, 100);
}

/** Player or world hands repair a route (culling road predators, guarded caravans). */
export function repairRoute(gs: GameState, aKey: string, bKey: string, amount: number): void {
  if (!amount) return;
  const r = routeOf(gs, aKey, bKey);
  r.cond = clamp(r.cond + amount, 0, 100);
}

/** Which side of a pair processes the transfer: the lexicographically first key, so a pair trades once a day. */
function isTradeTurn(myKey: string, pKey: string): boolean {
  return myKey < pKey;
}

/**
 * One settlement's market day: trade with each open partner — move goods
 * from surplus to shortage, coin the other way. Deterministic per (seed,
 * route, day); bounded work per settlement per day. Runs from the economy's
 * lazy catch-up (econOf), so far settlements trade the same bounded way when
 * next seen.
 */
export function marketDay(gs: GameState, f: Feature, e: { food: number; materials: number; wares: number; treasury: number }): void {
  const key = settlementId(f);
  for (const p of partnersOf(gs, f)) {
    const pKey = settlementId(p);
    if (!isTradeTurn(key, pKey)) continue;
    const r = routeOf(gs, key, pKey);
    if (r.cond < ROUTE_MIN) continue;
    const pe = gs.economy?.[pKey];
    if (!pe) continue;
    // the good this side has surplus in that the other side lacks
    const exportable: GoodId | null =
      GOOD_KEYS.find((g) => e[g] >= pe[g] + 5 && e[g] > 12) ?? null;
    if (exportable) {
      addGood(gs, pKey, exportable, FLOW);
      e[exportable] = clamp(e[exportable] - FLOW, 0, 60);
      addTreasury(gs, key, FLOW * COIN_PER_UNIT);
      addTreasury(gs, pKey, -FLOW * COIN_PER_UNIT);
    }
    // and the partner may send its own surplus back down the same road
    const importable: GoodId | null =
      GOOD_KEYS.find((g) => pe[g] >= e[g] + 5 && pe[g] > 12) ?? null;
    if (importable) {
      addGood(gs, key, importable, FLOW);
      e[importable] = clamp(e[importable] + FLOW, 0, 60);
      addTreasury(gs, key, -FLOW * COIN_PER_UNIT);
      addTreasury(gs, pKey, FLOW * COIN_PER_UNIT);
    }
  }
}

/** Prunes untouched route records — bounded state (called from the living-world daily tick). */
export function pruneRoutes(gs: GameState): void {
  const all = gs.routes;
  if (!all) return;
  const today = Math.floor(gs.tick / DAY_TICKS);
  for (const k in all) if (today - all[k].day > ROUTE_STALE_DAYS) delete all[k];
}

/**
 * Daily economic life for settlements around the traveler: their economies
 * step (econOf's bounded lazy catch-up) and then hold their market day, so
 * trade moves the same day production does. Far settlements do all of this
 * lazily when next seen. Runs inside advance()'s day block.
 */
export function econTickNear(gs: GameState, world: ReturnType<typeof getWorld>): void {
  const { x, y } = gs.player;
  const today = Math.floor(gs.tick / DAY_TICKS);
  for (const f of world.featuresNear(x, y, 96)) {
    if (!isSettlement(f)) continue;
    const e = econOf(gs, f);
    if ((e.tradeDay ?? -1) < today) {
      marketDay(gs, f, e);
      e.tradeDay = today;
    }
  }
}

