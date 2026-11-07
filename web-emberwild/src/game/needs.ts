import { BIOMES, DAY_TICKS } from "./data";
import { hash01, hash2 } from "./rng";
import { settlementSeed, settlementTier } from "./settlement";
import type { GameState, SettlementNeeds, SettlementProfile } from "./types";
import { type Feature, type World, getWorld } from "./world";

/**
 * Settlement needs — the living stocks of a community, kept per settlement
 * (`s:x:y`) in GameState and advanced only by the simulation:
 *
 *  - initialization is a pure function of world seed + settlement identity
 *    + biome + tier, so the same save always rebuilds the same starting need;
 *  - drift follows a slow daily mean-reversion toward the settlement's
 *    profile target, plus a deterministic weather-of-the-day wobble;
 *  - real events (contract payouts, deliveries) push individual stocks
 *    directly through applyNeedDelta;
 *  - catch-up after absence is bounded: a settlement seen after a hundred
 *    days reverts in at most NEED_CATCHUP_DAYS steps, and results stay
 *    inside [0, 100] always.
 *
 * No economy lives here — this is a lightweight heartbeat that gives the
 * contract board real conditions to answer.
 */

/** Catch-up work per settlement is bounded to this many simulated days. */
export const NEED_CATCHUP_DAYS = 40;
/** Far settlements beyond this radius never drift in the tick loop (lazy catch-up on visit). */
export const NEEDS_TICK_RADIUS = 96;

export const NEED_KEYS = ["food", "materials", "security", "trade", "population", "prosperity"] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

/** Profile drift targets — the single tuning surface for what a settlement lacks. */
const TARGETS: Record<SettlementProfile, Record<NeedKey, number>> = {
  farming: { food: 72, materials: 38, security: 55, trade: 45, population: 58, prosperity: 48 },
  mining: { food: 40, materials: 72, security: 50, trade: 55, population: 55, prosperity: 55 },
  frontier: { food: 50, materials: 45, security: 28, trade: 35, population: 40, prosperity: 34 },
  market: { food: 55, materials: 50, security: 55, trade: 72, population: 65, prosperity: 65 },
};

const HARSH_BIOMES = new Set(["gloomwood", "marsh", "tundra", "snow", "desert", "steppe"]);

/** The settlement's way of life: deterministic from seed + identity, steered by biome and tier. */
export function profileFor(seed: number, f: Feature): SettlementProfile {
  const tier = settlementTier(f);
  if (tier === "town" || tier === "city") {
    // larger settlements trade; whether they farm or mine still shows
    const h = hash01(seed ^ 0x9e3d, f.x, f.y);
    return h < 0.5 ? "market" : h < 0.75 ? "farming" : "mining";
  }
  const biome = getWorld(seed).tile(f.x, f.y).biome;
  const weighted: [SettlementProfile, number][] = [
    ["farming", biome === "meadow" || biome === "forest" ? 4 : biome === "river" ? 2 : 1],
    ["mining", biome === "hills" || biome === "mountain" ? 4 : 1],
    ["frontier", HARSH_BIOMES.has(biome) ? 4 : 1],
  ];
  const total = weighted.reduce((a, [, w]) => a + w, 0);
  const r = hash01(seed ^ 0x9e3c, f.x, f.y) * total;
  let acc = 0;
  for (const [p, w] of weighted) {
    acc += w;
    if (r < acc) return p;
  }
  return "farming";
}

/** Starting stocks: profile targets shaped by biome harshness, tier and a per-field jitter. */
export function initNeeds(gs: GameState, f: Feature): SettlementNeeds {
  const world = getWorld(gs.seed);
  const profile = profileFor(gs.seed, f);
  const biome = world.tile(f.x, f.y).biome;
  const tier = settlementTier(f) ?? "hamlet";
  const sseed = settlementSeed(gs.seed, f);
  const needs = {} as Record<NeedKey, number>;
  for (const k of NEED_KEYS) {
    let v = TARGETS[profile][k];
    if (HARSH_BIOMES.has(biome) && (k === "food" || k === "trade")) v -= 10;
    if (tier !== "hamlet" && (k === "trade" || k === "population" || k === "prosperity")) v += 8;
    // jitter: two farming hamlets still differ
    v += Math.round(hash01(sseed ^ 0x1eed, f.x + (k.length + 1) * 37, f.y) * 16) - 8;
    needs[k] = Math.max(0, Math.min(100, v));
  }
  return { ...needs, profile, day: Math.floor(gs.tick / DAY_TICKS) };
}

/** One bounded daily drift step: slow reversion toward the profile target plus a deterministic wobble. */
function driftStep(needs: SettlementNeeds, sseed: number, fx: number, fy: number, day: number): void {
  for (let ki = 0; ki < NEED_KEYS.length; ki++) {
    const k = NEED_KEYS[ki];
    const target = TARGETS[needs.profile][k];
    const wobble = Math.round(hash01(sseed ^ 0x77ab, fx + day * 131 + ki * 37, fy - day * 57) * 3) - 1;
    const v = needs[k] + Math.round((target - needs[k]) * 0.06) + wobble;
    needs[k] = Math.max(0, Math.min(100, v));
  }
}

/** Applies a real-world consequence to one stock (contract payouts, deliveries). Bounded, idempotent at the caller. */
export function applyNeedDelta(gs: GameState, key: string, field: NeedKey, delta: number): void {
  const all = (gs.settlementNeeds ??= {});
  const n = all[key];
  if (!n || !delta) return;
  n[field] = Math.max(0, Math.min(100, n[field] + delta));
}

/**
 * The needs of one settlement, created and caught up lazily. A settlement
 * never visited drifts in at most NEED_CATCHUP_DAYS deterministic steps —
 * the same save always reaches the same result.
 */
export function needsOf(gs: GameState, f: Feature): SettlementNeeds {
  const all = (gs.settlementNeeds ??= {});
  const key = `s:${f.x}:${f.y}`;
  let n = all[key];
  if (!n) {
    n = initNeeds(gs, f);
    all[key] = n;
    return n;
  }
  const today = Math.floor(gs.tick / DAY_TICKS);
  if (n.day < today) {
    const sseed = settlementSeed(gs.seed, f);
    let steps = Math.min(today - n.day, NEED_CATCHUP_DAYS);
    // bounded: long absences converge in one final stretch instead of day-by-day
    if (today - n.day > NEED_CATCHUP_DAYS) {
      for (let i = 0; i < steps; i++) driftStep(n, sseed, f.x, f.y, n.day + i);
      steps = 0;
    }
    for (let i = 0; i < steps; i++) driftStep(n, sseed, f.x, f.y, n.day + i);
    n.day = today;
  }
  return n;
}

/** Daily drift for settlements around the traveler; far ones catch up lazily when next seen. */
export function needsTickNear(gs: GameState, world: World): void {
  const { x, y } = gs.player;
  const today = Math.floor(gs.tick / DAY_TICKS);
  for (const f of world.featuresNear(x, y, NEEDS_TICK_RADIUS)) {
    const needs = needsOf(gs, f);
    if (needs.day < today) needs.day = today; // needsOf already caught this one up
  }
}
