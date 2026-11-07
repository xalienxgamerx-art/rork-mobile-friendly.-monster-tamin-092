import { BIOMES, DAY_TICKS, ITEMS, NAME_A, NAME_B, SHOP_STOCK, SPECIES } from "./data";
import { addGood } from "./economy";
import { addLog } from "./log";
import { applyNeedDelta, needsOf, type NeedKey } from "./needs";
import { hash2, Rng } from "./rng";
import { repOf, applyContractOutcome } from "./reputation";
import { isSettlement, settlementId, settlementSeed, settlementTier } from "./settlement";
import { assocAtKey, nationAtKey } from "./rumors";
import { onAidToSettlement } from "./worldevents";
import type { Contract, ContractCategory, ContractObjective, ContractState, FeatureId, GameState, ItemId } from "./types";
import { type Feature, getWorld } from "./world";

/**
 * Contracts — how an adventurer earns a living.
 *
 * A settlement's contract board answers its real conditions (needs.ts): a
 * village short of food posts gathering work, a frightened one posts culls,
 * an association chapter commissions monster handling. Offers are a
 * deterministic function of world seed + settlement + day — the same board
 * on the same day always shows the same work — and stay posted until they
 * expire or are declined.
 *
 * Rules of the system:
 *  - progress moves ONLY through authoritative gameplay events (a real kill,
 *    a real forage, a real first discovery, a real befriending). Nothing
 *    grants progress for existing at a menu;
 *  - work is claimed in person at the issuing settlement, and pays out
 *    exactly once (the status transition is the idempotency guard);
 *  - rewards move reputation through the one reputation ledger, settlement
 *    primary, nation and association secondary;
 *  - eight categories exist in the model; only the five with working hooks
 *    (hunting, gathering, delivery, exploration, monster handling) are ever
 *    offered. Investigation, protection and ecological contracts wait for
 *    their gameplay.
 *
 * No economy simulation lives here — completed contracts nudge the needs
 * that generated them, and that is the whole loop for this update.
 */

const ACTIVE_MAX = 3;
const HISTORY_MAX = 40;
/** Offers past this age are pruned from the board state (they regenerate deterministically anyway). */
const OFFER_STALE_DAYS = 8;
/** Discovery search radius for exploration contracts. */
const EXPLORE_RADIUS = 140;

/** How many slots a board has — bigger settlements carry more work. */
function boardSlots(f: Feature): number {
  const tier = settlementTier(f);
  return tier === "hamlet" ? 3 : 4;
}

/** The contract board state, backfilled for older saves. */
export function contractState(gs: GameState): ContractState {
  if (!gs.contracts) gs.contracts = { offers: {}, active: [], history: [], declined: {}, seq: 0 };
  const c = gs.contracts;
  c.offers ??= {};
  c.active ??= [];
  c.history ??= [];
  c.declined ??= {};
  c.seq ??= 0;
  return c;
}

/** The settlement Feature standing behind a contract key, or null. */
function featureOfKey(gs: GameState, key: string): Feature | null {
  const [, sx, sy] = key.split(":").map(Number);
  const f = getWorld(gs.seed).tile(sx, sy).feature;
  return f && isSettlement(f) ? f : null;
}

/** Whether the player stands in the issuing settlement right now. */
function atSettlement(gs: GameState, key: string): boolean {
  const f = featureOfKey(gs, key);
  if (!f) return false;
  const here = getWorld(gs.seed).siteAt(gs.player.x, gs.player.y);
  return !!here && isSettlement(here) && settlementId(here.feature) === key;
}

/** A settlement-scope community context for reputation and needs. */
function communityOf(gs: GameState, key: string): { key: string; nationId: string | null; assocId: string | null } {
  return { key, nationId: nationAtKey(gs, key), assocId: assocAtKey(gs, key) };
}

/* --------------------------------- Generation --------------------------------- */

const ISSUER_ROLES: Record<string, string[]> = {
  hamlet: ["innkeep", "trader", "village elder"],
  town: ["trader", "guild clerk", "chapter steward"],
  city: ["trader", "guild clerk", "ward captain"],
};

function issuerFor(gs: GameState, f: Feature, salt: number): { name: string; role: string } {
  const tier = settlementTier(f) ?? "hamlet";
  const roles = ISSUER_ROLES[tier];
  const h = hash2(settlementSeed(gs.seed, f) ^ 0x1550, salt, f.y * 7 + f.x);
  const name = `${NAME_A[(h >>> 4) % NAME_A.length]}${NAME_B[(h >>> 12) % NAME_B.length]}`;
  return { name, role: roles[(h >>> 20) % roles.length] };
}

/** Undiscovered landmarks within reach of a settlement. */
function undiscoveredNear(gs: GameState, f: Feature): { kind: FeatureId; name: string; x: number; y: number }[] {
  const k = gs.knowledge;
  return getWorld(gs.seed)
    .featuresNear(f.x, f.y, EXPLORE_RADIUS)
    .filter((x) => !k.discovered[`f:${x.x}:${x.y}`])
    .map((x) => ({ kind: x.kind, name: x.name, x: x.x, y: x.y }));
}

const ITEM_REWARDS: ItemId[] = ["tonic", "draught", "roasted_nuts", "antidote", "windstep"];

/** What a completed contract does to the needs that generated it. */
const NEED_BUMP: Partial<Record<ContractCategory, [NeedKey, number]>> = {
  hunting: ["security", 6],
  gathering: ["food", 6],
  delivery: ["trade", 8],
  exploration: ["trade", 4],
  monster_handling: ["prosperity", 5],
};

/** Builds one concrete offer of a category from the settlement's real conditions. */
function buildOffer(gs: GameState, f: Feature, category: ContractCategory, difficulty: number, salt: number, day: number): { objectives: ContractObjective[]; title: string; blurb: string } | null {
  const world = getWorld(gs.seed);
  // seeded from the DAY, never the tick: the same board must post all day,
  // whatever hour the player first (or again) opens it
  const daySeed = day * DAY_TICKS;
  const rng = new Rng(hash2(settlementSeed(gs.seed, f) ^ 0x6ef3, salt * 31 + difficulty, daySeed));
  const biome = world.tile(f.x, f.y).biome;
  const region = world.regionName(f.x, f.y);

  if (category === "hunting") {
    const spId = world.pickSpecies(biome, hash2(settlementSeed(gs.seed, f) ^ 0x40dd, salt, daySeed)) ?? Object.keys(SPECIES)[0];
    const sp = SPECIES[spId];
    const n = 2 + Math.floor(rng.next() * 2) + (difficulty >= 4 ? 1 : 0);
    return {
      title: `Cull of the ${sp.name}s`,
      blurb: `${sp.name}s prowl the ${region} lands and folk are afraid to walk at dusk. Thin their numbers.`,
      objectives: [{ kind: "kill", label: `Cull ${sp.name}s`, speciesId: spId, count: n, progress: 0 }],
    };
  }
  if (category === "gathering") {
    const local = BIOMES[biome].forage.map(([id]) => id);
    if (!local.length) return null;
    // food stores want food; workshops want materials (ore)
    const wantsOre = rng.next() < 0.35 && local.includes("ore");
    const pool = wantsOre ? (["ore"] as ItemId[]) : local.filter((i) => i !== "ore");
    if (!pool.length) return null;
    const itemId = pool[rng.int(0, pool.length - 1)];
    const n = 3 + Math.floor(rng.next() * 3) + Math.floor(difficulty / 2);
    return {
      title: `${ITEMS[itemId].name} for ${f.name}`,
      blurb: `The stores run low. Bring ${n}× ${ITEMS[itemId].name} — the ${region} grows it, they say.`,
      objectives: [{ kind: "forage", label: `Gather ${ITEMS[itemId].name}`, itemId, count: n, progress: 0 }],
    };
  }
  if (category === "delivery") {
    // goods any caravan stock can be asked for: always completable
    const itemId = SHOP_STOCK[rng.int(0, SHOP_STOCK.length - 1)];
    const n = 2 + Math.floor(rng.next() * 3);
    return {
      title: `Goods for the ${f.name} road`,
      blurb: `A trader waits on ${n}× ${ITEMS[itemId].name} from the caravans. Deliver them in person.`,
      objectives: [{ kind: "deliver", label: `Deliver ${ITEMS[itemId].name} ×${n}`, itemId, count: n, progress: 0 }],
    };
  }
  if (category === "exploration") {
    const cands = undiscoveredNear(gs, f);
    if (!cands.length) return null;
    const t = cands[rng.int(0, Math.min(2, cands.length - 1))];
    return {
      title: `Chart ${t.name}`,
      blurb: `The maps around ${f.name} have a blank patch where ${t.name} should stand. Go and put it on the map.`,
      objectives: [{ kind: "discover", label: `Discover ${t.name}`, featureKind: t.kind, target: { x: t.x, y: t.y, name: t.name }, count: 1, progress: 0 }],
    };
  }
  if (category === "monster_handling") {
    const spId = world.pickSpecies(biome, hash2(settlementSeed(gs.seed, f) ^ 0x71b5, salt, daySeed)) ?? Object.keys(SPECIES)[0];
    const sp = SPECIES[spId];
    const n = 1 + Math.floor(rng.next() * 2);
    return {
      title: `Hands for the beasts`,
      blurb: `The ${sp.name}s are clever bodies and cleverer appetites. Win one over — gently — and the ${f.name} folk will owe you.`,
      objectives: [{ kind: "befriend", label: `Befriend a ${sp.name}`, speciesId: spId, count: n, progress: 0 }],
    };
  }
  return null; // investigation / protection / ecological: no gameplay hooks yet
}

/**
 * The offers posted at a settlement today. Deterministic in seed + settlement
 * + day; the board only changes when the day does. Declined offers stay
 * declined for the day; expired work disappears with the morning.
 */
export function offersAt(gs: GameState, f: Feature): Contract[] {
  const cs = contractState(gs);
  const key = settlementId(f);
  const today = Math.floor(gs.tick / DAY_TICKS);
  const stored = cs.offers[key];
  // the day-stamped array is the board of record: accepted and declined work
  // keeps its place in it (with a spent status), so an emptied board can never
  // re-post an offer already accepted under the same id
  if (stored && stored.length && stored[0].postedDay === today) return stored.filter((o) => o.status === "offered" && !cs.declined[o.id]);
  const fresh = generateOffers(gs, f, today);
  cs.offers[key] = fresh;
  return fresh;
}

/** Deterministic daily board generation, driven by needs, tier and reputation. */
function generateOffers(gs: GameState, f: Feature, day: number): Contract[] {
  const cs = contractState(gs);
  const key = settlementId(f);
  const needs = needsOf(gs, f);
  const tier = settlementTier(f) ?? "hamlet";
  const rng = new Rng(hash2(settlementSeed(gs.seed, f) ^ 0xc0ab, day, f.y * 3 + f.x));
  const rep = repOf(gs, "player", "settlements", key);
  if ((rep ?? 0) <= -25) return []; // folk who distrust you do not hire you

  const exploreCands = undiscoveredNear(gs, f);
  const assocHere = !!assocAtKey(gs, key);
  const weights: [ContractCategory, number][] = [
    ["gathering", Math.max(6, (100 - needs.food) / 2 + (100 - needs.materials) / 2)],
    ["hunting", Math.max(6, 100 - needs.security)],
    ["delivery", Math.max(4, (100 - needs.trade) * 0.8)],
    ["exploration", exploreCands.length ? 30 : 0],
    ["monster_handling", assocHere ? 35 : 0],
  ];
  const used = new Set<ContractCategory>();
  const out: Contract[] = [];
  for (let i = 0; i < boardSlots(f); i++) {
    const pool = weights.filter(([c, w]) => w > 0 && !used.has(c));
    if (!pool.length) break;
    const total = pool.reduce((a, [, w]) => a + w, 0);
    let r = rng.next() * total;
    let category = pool[0][0];
    for (const [c, w] of pool) {
      r -= w;
      if (r <= 0) {
        category = c;
        break;
      }
    }
    const difficulty = Math.max(1, Math.min(5, 1 + rng.int(0, 2) + (tier === "town" ? 1 : 0) + (tier === "city" ? 2 : 0)));
    const seed = buildOffer(gs, f, category, difficulty, i, day);
    if (!seed) continue;
    used.add(category);
    const issuer = issuerFor(gs, f, i + (day % 17) * 5);
    // good standing earns better terms
    const repBonus = (rep ?? 0) >= 25 ? 1.15 : 1;
    const tierBonus = tier === "hamlet" ? 1 : 1.25;
    const contract: Contract = {
      id: `c:${f.x}:${f.y}:${day}:${i}`,
      category,
      title: seed.title,
      blurb: seed.blurb,
      issuer: issuer.name,
      issuerRole: issuer.role,
      settlementKey: key,
      settlementName: f.name,
      difficulty,
      postedDay: day,
      expiresDay: day + 2 + rng.int(0, 3),
      objectives: seed.objectives,
      reward: {
        gold: Math.round((14 + difficulty * 24) * repBonus * tierBonus),
        items: [{ id: ITEM_REWARDS[rng.int(0, ITEM_REWARDS.length - 1)], n: 1 }, ...(difficulty >= 4 ? [{ id: ITEM_REWARDS[rng.int(0, ITEM_REWARDS.length - 1)], n: 1 }] : [])],
        rep: 2 + difficulty,
      },
      status: "offered",
    };
    if (cs.declined[contract.id]) continue;
    out.push(contract);
  }
  return out;
}

/* ---------------------------------- Lifecycle --------------------------------- */

/** Accepts a posted contract. Returns a message, or null when it cannot be accepted. */
export function acceptContract(gs: GameState, id: string): string | null {
  const cs = contractState(gs);
  if (cs.active.length >= ACTIVE_MAX) return `You can only carry ${ACTIVE_MAX} contracts at once.`;
  for (const key in cs.offers) {
    const c = cs.offers[key]?.find((o) => o.id === id && o.status === "offered");
    if (!c) continue;
    // exploration work names a real blank patch of map; if it was charted in
    // the meantime, the contract cannot be honestly accepted
    if (c.category === "exploration") {
      const t = c.objectives[0].target;
      if (t && gs.knowledge.discovered[`f:${t.x}:${t.y}`]) return "That ground has already been charted.";
    }
    c.status = "active";
    c.acceptedDay = Math.floor(gs.tick / DAY_TICKS);
    cs.active.push(c);
    return `Contract accepted: ${c.title}`;
  }
  return null;
}

/** Declines a posted offer — it stays declined for the rest of the day. */
export function declineContract(gs: GameState, id: string): void {
  const cs = contractState(gs);
  for (const key in cs.offers) {
    const arr = cs.offers[key];
    const c = arr?.find((o) => o.id === id && o.status === "offered");
    if (!c) continue;
    cs.declined[id] = 1;
    return;
  }
}

function finish(gs: GameState, c: Contract, status: "completed" | "failed" | "expired"): void {
  c.status = status;
  c.finishedDay = Math.floor(gs.tick / DAY_TICKS);
  const cs = contractState(gs);
  cs.active = cs.active.filter((a) => a.id !== c.id);
  cs.history.push(c);
  while (cs.history.length > HISTORY_MAX) cs.history.shift();
}

/** Abandons active work — the settlement hears of it, and remembers. */
export function abandonContract(gs: GameState, id: string): string | null {
  const cs = contractState(gs);
  const c = cs.active.find((a) => a.id === id);
  if (!c) return null;
  finish(gs, c, "failed");
  applyContractOutcome(gs, "player", communityOf(gs, c.settlementKey), `${c.id}:abandon`, -2);
  return `You walk away from "${c.title}". Word will get around.`;
}

/** Whether every objective of this contract is fully progressed. */
export function objectivesDone(c: Contract): boolean {
  return c.objectives.every((o) => o.progress >= o.count);
}

/**
 * Whether the reward can be settled now — the UI's claim-button gate, kept
 * beside claimContract so the two can never disagree. Delivery work is
 * settled by handing goods over, so the bag (not tracked progress) gates it.
 */
export function claimReady(gs: GameState, c: Contract): boolean {
  if (c.category === "delivery") {
    const o = c.objectives[0];
    return (gs.bag[o.itemId!] ?? 0) >= o.count;
  }
  return objectivesDone(c);
}

/**
 * Claims the reward for active work, in person, at the issuing settlement.
 * Delivery work hands over the goods here (they are consumed); everything
 * else requires its objectives complete. Pays exactly once.
 */
export function claimContract(gs: GameState, id: string): string | null {
  const cs = contractState(gs);
  const c = cs.active.find((a) => a.id === id);
  if (!c) return null;
  if (!atSettlement(gs, c.settlementKey)) return `Return to ${c.settlementName} to settle this contract.`;
  if (c.category === "delivery") {
    const o = c.objectives[0];
    const itemId = o.itemId!;
    const have = gs.bag[itemId] ?? 0;
    if (have < o.count) return `You still owe ${o.count - have}× ${ITEMS[itemId].name}.`;
    gs.bag[itemId] = have - o.count;
    o.progress = o.count;
  } else if (!objectivesDone(c)) {
    return "The work is not finished yet.";
  }
  // pay out exactly once: the status transition is the guard
  finish(gs, c, "completed");
  gs.player.gold += c.reward.gold;
  for (const r of c.reward.items) gs.bag[r.id] = (gs.bag[r.id] ?? 0) + r.n;
  applyContractOutcome(gs, "player", communityOf(gs, c.settlementKey), c.id, c.reward.rep);
  // the community's stocks feel the deed: hunting steadies, goods fill shelves
  const f = featureOfKey(gs, c.settlementKey);
  const bump = NEED_BUMP[c.category];
  if (f && bump) {
    needsOf(gs, f); // ensure the record exists before nudging it
    applyNeedDelta(gs, c.settlementKey, bump[0], bump[1]);
    addGood(gs, c.settlementKey, bump[0] === "food" ? "food" : bump[0] === "materials" ? "materials" : "wares", 2);
  }
  // settled work is aid the living world counts: shortages break, roads mend
  onAidToSettlement(gs, c.settlementKey);
  const items = c.reward.items.map((r) => `${r.n}× ${ITEMS[r.id].name}`).join(", ");
  return `Contract complete: ${c.title}. +${c.reward.gold} gold${items ? `, ${items}` : ""}.`;
}

/* ------------------------------- Event hooks ---------------------------------- */

/** Advances every active contract matching an authoritative kill. */
export function onKill(gs: GameState, speciesId: string): void {
  const cs = contractState(gs);
  for (const c of cs.active) {
    if (c.category !== "hunting") continue;
    for (const o of c.objectives) {
      if (o.kind === "kill" && o.speciesId === speciesId && o.progress < o.count) {
        o.progress += 1;
        progressLog(gs, c, o);
      }
    }
  }
}

/** Advances gathering work after a real forage. */
export function onForage(gs: GameState, itemId: ItemId, n: number): void {
  const cs = contractState(gs);
  for (const c of cs.active) {
    if (c.category !== "gathering") continue;
    for (const o of c.objectives) {
      if (o.kind === "forage" && o.itemId === itemId && o.progress < o.count) {
        o.progress = Math.min(o.count, o.progress + n);
        progressLog(gs, c, o);
      }
    }
  }
}

/** Advances exploration work on a real first-time discovery. */
export function onDiscover(gs: GameState, x: number, y: number): void {
  const cs = contractState(gs);
  for (const c of cs.active) {
    if (c.category !== "exploration") continue;
    for (const o of c.objectives) {
      if (o.kind === "discover" && o.target && o.target.x === x && o.target.y === y && o.progress < o.count) {
        o.progress = o.count;
        progressLog(gs, c, o);
      }
    }
  }
}

/** Advances monster-handling work on a real befriending. */
export function onTame(gs: GameState, speciesId: string): void {
  const cs = contractState(gs);
  for (const c of cs.active) {
    if (c.category !== "monster_handling") continue;
    for (const o of c.objectives) {
      if (o.kind === "befriend" && o.speciesId === speciesId && o.progress < o.count) {
        o.progress += 1;
        progressLog(gs, c, o);
      }
    }
  }
}

function progressLog(gs: GameState, c: Contract, o: ContractObjective): void {
  if (objectivesDone(c)) addLog(gs, `Work done for ${c.settlementName} — return to settle "${c.title}".`, "good");
  else addLog(gs, `${c.title}: ${o.label} — done.`, "good");
}

/* --------------------------------- Daily tick --------------------------------- */

/** Daily housekeeping: expire stale work, prune the board. Runs inside advance(). */
export function advanceContracts(gs: GameState): void {
  const cs = contractState(gs);
  const today = Math.floor(gs.tick / DAY_TICKS);
  for (const c of [...cs.active]) {
    if (today > c.expiresDay) {
      finish(gs, c, "expired");
      addLog(gs, `The contract "${c.title}" has lapsed. ${c.issuer} will have heard by now.`, "info");
    }
  }
  for (const key in cs.offers) {
    const arr = cs.offers[key];
    if (!arr?.length || today - arr[0].postedDay > OFFER_STALE_DAYS) delete cs.offers[key];
  }
  if (Object.keys(cs.declined).length > 200) cs.declined = {};
}

/** How much work the player is carrying (drives the Contracts badge). */
export function activeContractCount(gs: GameState): number {
  return gs.contracts?.active.length ?? 0;
}

/** Save migration (v25): per-settlement needs and the contract board, backfilled for older saves. */
export function migrateContracts(gs: GameState): void {
  gs.settlementNeeds ??= {};
  contractState(gs);
}
