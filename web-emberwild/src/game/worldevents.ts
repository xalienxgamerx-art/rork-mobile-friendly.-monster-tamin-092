import { DAY_TICKS, ITEMS, SPECIES } from "./data";
import { addGood, addTreasury, econOf, merchantPrice } from "./economy";
import { addLog } from "./log";
import { applyNeedDelta, needsOf } from "./needs";
import { hash01, hash2, hashString } from "./rng";
import { applyOrgStanding } from "./reputation";
import { isSettlement, settlementId } from "./settlement";
import { disruptRoute, partnersOf, repairRoute, routeKeyBetween, routeOf } from "./trade";
import type { DevInstance, DevKind, DevOutcome, DevRecord, GameState, LivingWorldState } from "./types";
import { type Feature, getWorld } from "./world";

/**
 * World developments (Update E) — persistent, living-world events with a real
 * lifecycle. This is deliberately NOT the career WorldEvent ledger (rumors.ts,
 * which records duels and alpha deeds): developments are what whole
 * communities live through — shortages, prowling predators, cut roads, charted
 * country, good seasons.
 *
 * Shape of the system:
 *  - DEFINITIONS (DevDef, below) are static data: eligibility, weight,
 *    cooldown, duration, daily pressure, resolution rules. They never hold state.
 *  - INSTANCES (DevInstance in gs.living.active) are the only mutable records,
 *    bounded (ACTIVE_CAP), each anchored to one settlement;
 *  - a DISPATCHER (advanceLivingWorld) runs once per in-world day inside
 *    advance()'s day block: it ticks active developments, resolves finished
 *    ones, and spawns at most one new development per day among settlements
 *    the player has actually discovered — the far world stays abstract;
 *  - CONSEQUENCES move only through authoritative systems: applyNeedDelta for
 *    the needs heartbeat, economy stores and treasuries, trade-route
 *    condition, reputation's one ledger. Nothing here keeps a second copy;
 *  - INTERVENTION: the player resolves developments through the same real
 *    actions that already drive the world (kills on the doorstep, delivering
 *    goods, charting blank map near a town — fed in by the authoritative
 *    hooks). NPCs intervene too: after a grace period, neighboring
 *    settlements have a deterministic chance to handle a problem themselves.
 *
 * Every probability is a hash of seed + day + target — no Math.random, no
 * wall clock, the same save always plays out the same world.
 */

/* --------------------------------- config ---------------------------------- */

const ACTIVE_CAP = 8;
const HISTORY_CAP = 60;
/** Developments spawn slowly: at most one new one per day, anywhere. */
const SPAWNS_PER_DAY = 1;
/** How close the player must act for it to count as helping this settlement. */
export const DEV_WITNESS = 44;
/** Grace days before the world may solve its own problems. */
const WORLD_GRACE_DAYS = 3;
/** Kills that clear a predator outbreak. */
export const PREDATOR_KILLS = 3;
/** Aid deliveries that break a shortage. */
export const SHORTAGE_AID = 2;
/** Days of aid that end a hard season early (not used — blooms end on time). */

/** The one mutable ledger, backfilled for older saves. */
export function livingOf(gs: GameState): LivingWorldState {
  const l = (gs.living ??= { active: [], history: [], lastFired: {}, seq: 0 });
  l.active ??= [];
  l.history ??= [];
  l.lastFired ??= {};
  l.seq ??= 0;
  return l;
}

/* ------------------------------- definitions -------------------------------- */

interface DevDef {
  kind: DevKind;
  /** Days before the same development may haunt the same settlement again. */
  cooldown: number;
  /** Duration range in days (before early resolution). */
  dur: [number, number];
  /** Deterministic spawn weight (0 = never now). */
  weight: (gs: GameState, f: Feature, day: number) => number;
  /** Extra instance parameters, deterministic. */
  params?: (gs: GameState, f: Feature, day: number, key: string) => Partial<DevInstance>;
  /** One day of pressure while active. */
  daily: (gs: GameState, dev: DevInstance, f: Feature, day: number) => void;
  /** Whether the development has been resolved by conditions alone. */
  done?: (gs: GameState, dev: DevInstance, f: Feature) => boolean;
  /** Recovery applied when the development ends (any outcome). */
  recover: (gs: GameState, dev: DevInstance, f: Feature) => void;
  /** Headline and rumor phrasing, for logs, notices and residents. */
  headline: (dev: DevInstance) => string;
  rumor: (dev: DevInstance) => string;
}

const defs: Record<DevKind, DevDef> = {
  shortage: {
    kind: "shortage",
    cooldown: 10,
    dur: [4, 7],
    weight: (gs, f) => {
      const e = gs.economy?.[settlementId(f)];
      const n = needsOf(gs, f);
      if (!e || e.food > 14 || n.food > 50) return 0;
      return (14 - e.food) * 4;
    },
    daily: (gs, dev, f, day) => {
      addGood(gs, dev.key, "food", -1);
      if (day % 2 === 0) applyNeedDelta(gs, dev.key, "food", -1);
    },
    done: (gs, dev, f) => (gs.economy?.[dev.key]?.food ?? 0) >= 20,
    recover: (gs, dev, f) => {
      addGood(gs, dev.key, "food", 10);
      applyNeedDelta(gs, dev.key, "food", 8);
    },
    headline: (d) => `Hard times: ${d.name}'s granaries run low`,
    rumor: (d) => `${d.name} is going hungry — the granaries are near empty, folk say.`,
  },
  predators: {
    kind: "predators",
    cooldown: 14,
    dur: [5, 9],
    weight: (gs, f, day) => {
      const n = needsOf(gs, f);
      if (n.security > 48) return 0;
      return 48 - n.security;
    },
    params: (gs, f, day, key) => {
      const world = getWorld(gs.seed);
      const h = hash2(gs.seed ^ 0x9de7, day, f.x * 131 + f.y);
      const spId = world.pickSpecies(world.tile(f.x, f.y).biome, h) ?? Object.keys(SPECIES)[0];
      return { speciesId: spId, progress: 0 };
    },
    daily: (gs, dev, _f, day) => {
      if (day % 2 === 0) applyNeedDelta(gs, dev.key, "security", -1);
      if (day % 3 === 0) {
        // the roads suffer too: carts are waylaid
        const f = settlementFeatureOf(gs, dev.key);
        if (f) for (const p of partnersOf(gs, f)) disruptRoute(gs, dev.key, settlementId(p), 6);
      }
    },
    done: (gs, dev) => (dev.progress ?? 0) >= PREDATOR_KILLS,
    recover: (gs, dev, f) => {
      applyNeedDelta(gs, dev.key, "security", 8);
      for (const p of partnersOf(gs, f)) repairRoute(gs, dev.key, settlementId(p), 24);
    },
    headline: (d) => `Beasts at the gates: ${SPECIES[d.speciesId ?? ""]?.name ?? "predators"} prowl near ${d.name}`,
    rumor: (d) => `${SPECIES[d.speciesId ?? ""]?.name ?? "beast"}s have been prowling the fields of ${d.name} — folk are afraid to walk at dusk.`,
  },
  trade: {
    kind: "trade",
    cooldown: 12,
    dur: [4, 8],
    weight: (gs, f) => (partnersOf(gs, f).length ? 12 : 0),
    params: (gs, f) => {
      // the weakest road out of town is the one that collapses
      let worst: string | null = null;
      let worstCond = 101;
      for (const p of partnersOf(gs, f)) {
        const r = routeOf(gs, settlementId(f), settlementId(p));
        if (r.cond < worstCond) {
          worstCond = r.cond;
          worst = routeKeyBetween(settlementId(f), settlementId(p));
        }
      }
      return { routeKey: worst ?? undefined };
    },
    daily: (gs, dev) => {
      if (dev.routeKey) {
        const other = otherEnd(dev.routeKey, dev.key);
        if (other) disruptRoute(gs, dev.key, other, 8);
      }
    },
    done: (gs, dev) => {
      const other = dev.routeKey ? otherEnd(dev.routeKey, dev.key) : null;
      return !!other && routeOf(gs, dev.key, other).cond >= 70;
    },
    recover: (gs, dev, f) => {
      const other = dev.routeKey ? otherEnd(dev.routeKey, dev.key) : null;
      if (other) repairRoute(gs, dev.key, other, 15);
      applyNeedDelta(gs, dev.key, "trade", 4);
      void f;
    },
    headline: (d) => `The road is cut: trade grinds to a halt outside ${d.name}`,
    rumor: (d) => `The road to ${d.name} is all but closed — nothing has come up or down it for days.`,
  },
  discovery: {
    kind: "discovery",
    cooldown: 20,
    dur: [6, 12],
    weight: (gs, f) => {
      // a blank patch of map within a day's walk gives folk something to wonder at
      const near = getWorld(gs.seed)
        .featuresNear(f.x, f.y, 70)
        .filter((x) => !gs.knowledge.discovered[`f:${x.x}:${x.y}`]);
      return near.length ? 15 : 0;
    },
    daily: () => {},
    done: (gs, dev) => (dev.progress ?? 0) >= 1,
    recover: (gs, dev) => {
      applyNeedDelta(gs, dev.key, "trade", 6);
      addTreasury(gs, dev.key, 20);
    },
    headline: (d) => `Wonder abroad: ${d.name} talks of uncharted country`,
    rumor: (d) => `Folk in ${d.name} have been asking after the blank places on the map — chart them and they'll thank you.`,
  },
  bloom: {
    kind: "bloom",
    cooldown: 16,
    dur: [5, 9],
    weight: (gs, f) => {
      const n = needsOf(gs, f);
      const e = gs.economy?.[settlementId(f)];
      if (n.prosperity < 50 || !e || e.food < 24) return 0;
      return 10;
    },
    daily: (gs, dev) => {
      applyNeedDelta(gs, dev.key, "prosperity", 1);
      addTreasury(gs, dev.key, 3);
    },
    recover: (gs, dev) => {
      applyNeedDelta(gs, dev.key, "trade", 3);
      applyNeedDelta(gs, dev.key, "population", 3);
    },
    headline: (d) => `Good season: coin and cheer flow in ${d.name}`,
    rumor: (d) => `These are good days in ${d.name} — full carts, full purses, they say.`,
  },
};

/** The other settlement key on a route key `r:a|b` (null if this key is not one end). */
function otherEnd(routeKey: string, myKey: string): string | null {
  const m = routeKey.match(/^r:(s:\d+:\d+)\|(s:\d+:\d+)$/);
  if (!m) return null;
  return m[1] === myKey ? m[2] : m[2] === myKey ? m[1] : null;
}

/** The Feature behind a settlement key, if it is still a settlement. */
function settlementFeatureOf(gs: GameState, key: string): Feature | null {
  const [, sx, sy] = key.split(":").map(Number);
  const f = getWorld(gs.seed).tile(sx, sy).feature;
  return f && isSettlement(f) ? f : null;
}

/* -------------------------------- lifecycle --------------------------------- */

/** Spawns one development of a kind at a settlement. Returns the instance or null (cooldown/cap). */
function spawnDev(gs: GameState, kind: DevKind, f: Feature, day: number): DevInstance | null {
  const l = livingOf(gs);
  const key = settlementId(f);
  if (l.active.length >= ACTIVE_CAP) return null;
  if (l.active.some((d) => d.defId === kind && d.key === key)) return null;
  const since = l.lastFired[`${kind}:${key}`];
  if (since !== undefined && day - since < defs[kind].cooldown) return null;
  const dur = defs[kind].dur;
  const span = dur[1] - dur[0];
  const ends = day + dur[0] + Math.floor(hash01(gs.seed ^ 0xdef0, day, f.x * 17 + f.y) * (span + 1));
  const dev: DevInstance = {
    id: `d${(l.seq ?? 0) + 1}`,
    defId: kind,
    key,
    name: f.name,
    startedDay: day,
    endsDay: ends,
  };
  l.seq += 1;
  econOf(gs, f); // ensure the economy record exists before pressure lands on it
  Object.assign(dev, defs[kind].params?.(gs, f, day, key) ?? {});
  l.active.push(dev);
  l.lastFired[`${kind}:${key}`] = day;
  // the world takes notice: the community's ledger and the player's ear
  if (gs.knowledge.discovered[`f:${f.x}:${f.y}`]) {
    addLog(gs, defs[kind].headline(dev), "info");
  }
  return dev;
}

/** Ends a development: recovery effects, a history record, and word if the player knows the place. */
function endDev(gs: GameState, dev: DevInstance, outcome: DevOutcome, day: number): void {
  const l = livingOf(gs);
  l.active = l.active.filter((d) => d.id !== dev.id);
  const f = settlementFeatureOf(gs, dev.key);
  if (f) defs[dev.defId].recover(gs, dev, f);
  const rec: DevRecord = { id: dev.id, defId: dev.defId, key: dev.key, name: dev.name, startedDay: dev.startedDay, endedDay: day, outcome };
  l.history.push(rec);
  if (l.history.length > HISTORY_CAP) l.history.splice(0, l.history.length - HISTORY_CAP);
  if (f && gs.knowledge.discovered[`f:${f.x}:${f.y}`]) {
    const tail = outcome === "player" ? "Your doing, folk say." : outcome === "world" ? "The roads brought help." : "It passed with the season.";
    addLog(gs, `${defs[dev.defId].headline(dev)} — over. ${tail}`, outcome === "player" ? "good" : "info");
  }
  // honest work earns standing in the one settlement ledger
  if (outcome === "player" && f) {
    applyOrgStanding(gs, "player", "settlements", dev.key, 4, `dev:${dev.id}`);
  }
}

/** One day in the life of an active development: pressure, conditions, natural end. */
function devDay(gs: GameState, dev: DevInstance, day: number): void {
  const f = settlementFeatureOf(gs, dev.key);
  if (!f) {
    endDev(gs, dev, "lapsed", day);
    return;
  }
  defs[dev.defId].daily(gs, dev, f, day);
  if (defs[dev.defId].done?.(gs, dev, f)) {
    endDev(gs, dev, "world", day);
    return;
  }
  // the world intervenes too: after a grace period, neighbors may handle it
  if (day - dev.startedDay >= WORLD_GRACE_DAYS) {
    const chance = hash01(gs.seed ^ 0x401d, day, hashString(dev.id) ^ hashString(dev.key));
    if (chance < (dev.defId === "bloom" ? 0 : 0.12)) {
      endDev(gs, dev, "world", day);
      return;
    }
  }
  if (day >= dev.endsDay) endDev(gs, dev, "lapsed", day);
}

/**
 * The living world's daily beat. Runs inside advance()'s day block: tick
 * every active development, then consider spawning one new development among
 * the settlements the player has discovered (a bounded set — the far world
 * keeps its own abstract life in distant.ts).
 */
export function advanceLivingWorld(gs: GameState): void {
  const day = Math.floor(gs.tick / DAY_TICKS);
  const l = livingOf(gs);
  for (const dev of [...l.active]) devDay(gs, dev, day);
  pruneCooldowns(l, day);
  // candidates: discovered settlements only — bounded, and honest knowledge
  const world = getWorld(gs.seed);
  const candidates: Feature[] = [];
  for (const k in gs.knowledge.discovered) {
    if (!k.startsWith("f:")) continue;
    const [, x, y] = k.split(":").map(Number);
    const f = world.tile(x, y).feature;
    if (f && isSettlement(f)) candidates.push(f);
  }
  if (!candidates.length) return;
  // at most SPAWNS_PER_DAY developments begin per day, world-wide: one beat
  if (l.active.some((d) => d.startedDay === day)) return;
  for (let i = 0; i < SPAWNS_PER_DAY; i++) {
    // weighted pick across all candidate settlements and kinds
    const pool: { f: Feature; kind: DevKind; w: number }[] = [];
    let total = 0;
    for (const f of candidates) {
      for (const kind of Object.keys(defs) as DevKind[]) {
        const w = defs[kind].weight(gs, f, day);
        if (w > 0) {
          pool.push({ f, kind, w });
          total += w;
        }
      }
    }
    if (!pool.length) return;
    let r = hash01(gs.seed ^ 0x71f3, day, i * 977) * total;
    for (const c of pool) {
      r -= c.w;
      if (r <= 0) {
        spawnDev(gs, c.kind, c.f, day);
        break;
      }
    }
  }
}

/** Cooldown records are bounded: forget pairs not fired in a season of cooldowns. */
function pruneCooldowns(l: LivingWorldState, day: number): void {
  for (const k in l.lastFired) {
    if (day - l.lastFired[k] > 60) delete l.lastFired[k];
  }
}

/* -------------------------- intervention hooks ------------------------------- */

/**
 * An authoritative kill happened in the world. Predator outbreaks near a
 * settlement count culls toward their resolution; the roads the beasts
 * haunted recover.
 */
export function onWorldKill(gs: GameState, speciesId: string, x: number, y: number): void {
  const l = gs.living;
  if (!l?.active.length) return;
  const day = Math.floor(gs.tick / DAY_TICKS);
  for (const dev of [...l.active]) {
    if (dev.defId !== "predators" || dev.speciesId !== speciesId) continue;
    const f = settlementFeatureOf(gs, dev.key);
    if (!f || Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) > DEV_WITNESS) continue;
    dev.progress = (dev.progress ?? 0) + 1;
    if (dev.progress >= PREDATOR_KILLS) endDev(gs, dev, "player", day);
  }
}

/**
 * Goods or honest work reached a settlement (a claimed contract counts — the
 * only in-person delivery path). Shortages count aid; cut roads are mended
 * by caravans moving again.
 */
export function onAidToSettlement(gs: GameState, key: string): void {
  const l = gs.living;
  if (!l?.active.length) return;
  const day = Math.floor(gs.tick / DAY_TICKS);
  for (const dev of [...l.active]) {
    if (dev.key !== key) continue;
    if (dev.defId === "shortage") {
      dev.progress = (dev.progress ?? 0) + 1;
      if (dev.progress >= SHORTAGE_AID) endDev(gs, dev, "player", day);
    } else if (dev.defId === "trade" && dev.routeKey) {
      const other = otherEnd(dev.routeKey, dev.key);
      if (other) repairRoute(gs, key, other, 25);
    }
  }
}

/** A landmark was charted for the first time. Wonder near a town becomes news, then trade. */
export function onWorldDiscover(gs: GameState, x: number, y: number): void {
  const l = gs.living;
  if (!l?.active.length) return;
  const day = Math.floor(gs.tick / DAY_TICKS);
  for (const dev of [...l.active]) {
    if (dev.defId !== "discovery") continue;
    const f = settlementFeatureOf(gs, dev.key);
    if (!f || Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) > 80) continue;
    dev.progress = (dev.progress ?? 0) + 1;
    endDev(gs, dev, "player", day);
  }
}

/* --------------------------------- queries ---------------------------------- */

/** Active developments at one settlement. */
export function devsAt(gs: GameState, key: string): DevInstance[] {
  return (gs.living?.active ?? []).filter((d) => d.key === key);
}

/** Active developments the player can honestly know: discovered settlements only. */
export function devsKnownToPlayer(gs: GameState, limit = 12): DevInstance[] {
  const world = getWorld(gs.seed);
  const out: DevInstance[] = [];
  for (const dev of [...(gs.living?.active ?? [])].reverse()) {
    if (out.length >= limit) break;
    const [, x, y] = dev.key.split(":").map(Number);
    if (gs.knowledge.discovered[`f:${x}:${y}`] && world.tile(x, y).feature) out.push(dev);
  }
  return out;
}

/** A resident's line about a development haunting their town (deterministic per day). */
export function devLines(gs: GameState, key: string, h: number): string[] {
  const devs = devsAt(gs, key);
  if (!devs.length) return [];
  const dev = devs[h % devs.length];
  return [defs[dev.defId].rumor(dev)];
}

/* ------------------------------ shop integration ----------------------------- */

/**
 * The price a development's pressure adds on top of the plain economy price:
 * shortages mark food up, cut roads mark imported wares up, good seasons
 * cheapen everything a little. 1 = no effect.
 */
function devMul(gs: GameState, f: Feature, itemId: string): number {
  const key = settlementId(f);
  let mul = 1;
  for (const dev of devsAt(gs, key)) {
    if (dev.defId === "shortage" && itemId !== "ore" && (ITEMS[itemId as keyof typeof ITEMS]?.food ?? 0) > 0) mul *= 1.3;
    if (dev.defId === "trade" && (ITEMS[itemId as keyof typeof ITEMS]?.food ?? 0) === 0) mul *= 1.2;
    if (dev.defId === "bloom") mul *= 0.95;
  }
  return mul;
}

/** The one shop price: settlement economy first, development pressure on top. */
export function shopPrice(gs: GameState, f: Feature | null, itemId: string, mode: "buy" | "sell"): number | null {
  if (!f) return null;
  const base = merchantPrice(gs, f, itemId, mode);
  if (base === null) return null;
  return Math.max(1, Math.round(base * devMul(gs, f, itemId)));
}

/** What the trader pays the player for one item of their bag, at this settlement. */
export function sellPrice(gs: GameState, f: Feature | null, itemId: string): number | null {
  return shopPrice(gs, f, itemId, "sell");
}

/** Debug helper: bounded state size (mapcheck). */
export function livingStateSize(gs: GameState): number {
  const l = gs.living;
  return (l?.active.length ?? 0) + (l?.history.length ?? 0) + Object.keys(l?.lastFired ?? {}).length + Object.keys(gs.economy ?? {}).length + Object.keys(gs.routes ?? {}).length;
}

/** Migration backfill (v31): ledgers start empty; economies and routes build lazily. Idempotent. */
export function migrateLivingWorld(gs: GameState): void {
  livingOf(gs);
  gs.economy ??= {};
  gs.routes ??= {};
}
