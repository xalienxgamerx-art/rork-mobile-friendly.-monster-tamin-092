import { BIOMES, DAY_TICKS, ITEMS, SPECIES } from "./data";
import { GUILD_ORG, guildByKey, getGuilds } from "./guild";
import { heightOf } from "./height";
import { statOf } from "./monster";
import { addLog } from "./log";
import { getFactions } from "./factions";
import { sightRadius } from "./perception";
import { repOf, applyOrgStanding } from "./reputation";
import { hash2, Rng } from "./rng";
import { isSettlement, settlementId, settlementSeed } from "./settlement";
import type {
  ExpeditionCategory,
  ExpeditionInstance,
  ExpeditionObjective,
  ExpeditionOffer,
  ExpeditionReward,
  ExpeditionState,
  GameState,
  ItemId,
  TraitId,
} from "./types";
import type { Feature } from "./world";
import { getWorld } from "./world";

/**
 * Expeditions — the Expeditioner's Guild turns wandering into fieldwork.
 *
 * An expedition is a planned journey into the real world with objectives that
 * only real actions complete: a genuine first discovery, a genuine forage, a
 * genuine kill, a genuine ruin search, a genuine arrival, a genuine sighting.
 * Nothing grants progress for opening a menu.
 *
 * The organization is deliberately separate from the beast-tamer
 * associations: the Guild administers every expedition, but commissions can
 * come from an association, a settlement or anyone else — recorded as a
 * distinct identity that shares neither ledger nor authority with the Guild.
 *
 * Rules of the system:
 *  - definitions are data; offers are definitions resolved against one
 *    actual world (a definition whose destination doesn't exist here is
 *    simply never posted);
 *  - registration is atomic: an invalid party or an unaffordable supply
 *    list consumes nothing;
 *  - supplies leave the bag at departure and live on the expedition record;
 *  - rewards pay exactly once (the status transition is the guard), and
 *    Guild standing moves only the Guild's own ledger;
 *  - failed and abandoned work preserves discoveries and pays, at most, a
 *    partial purse for objectives genuinely finished.
 */

const HISTORY_MAX = 30;
const BOARD_SLOTS = 3;
/** Offer lifetimes and expedition deadlines, in days. */
const OFFER_DAYS = 3;
const PARTIAL_FRACTION = 0.5; // failed/abandoned work pays half the purse's share of finished objectives

/** Items the Guild accepts as registered expedition supplies. */
export const SUPPLY_ITEMS: ItemId[] = [
  "tonic", "draught", "greater_tonic", "antidote", "firebane", "brighteye", "windstep", "warybrew", "ironbrew",
  "roasted_fish", "roasted_veg", "smoked_meat", "trail_mix", "nut_loaf", "grilled_skewers", "garlic_steak",
  "charred_roots", "hearty_stew", "hunters_hotpot", "soothing_porridge", "honey_tart", "dragonbread", "wanderers_feast",
  "berries", "nuts", "fish", "meat",
];

/* --------------------------------- State -------------------------------------- */

/** The Guild state, backfilled for older saves. */
export function expeditionState(gs: GameState): ExpeditionState {
  if (!gs.expeditions) gs.expeditions = { active: [], history: [], seq: 0, offers: {}, declined: {} };
  const e = gs.expeditions;
  e.active ??= [];
  e.history ??= [];
  e.seq ??= 0;
  e.offers ??= {};
  e.declined ??= {};
  return e;
}

export function isMember(gs: GameState): boolean {
  return gs.expeditions?.memberSince !== undefined;
}

/** The player's standing with one chapter (0 for strangers and non-members). */
export function standingOf(gs: GameState, guildKey: string): number {
  return repOf(gs, "player", "guilds", guildKey) ?? 0;
}

/** How much fieldwork the player is carrying (drives the Guild badge). */
export function activeExpeditionCount(gs: GameState): number {
  return gs.expeditions?.active.filter((a) => a.status === "active").length ?? 0;
}

/* ------------------------------ World resolution ------------------------------ */

interface Resolved {
  title: string;
  blurb: string;
  destName: string;
  dest: { x: number; y: number };
  region: string;
  objectives: ExpeditionObjective[];
  recommended: ItemId[];
  minParty: number;
  /** Knowledge the Guild pays for (legendary records). */
  clue?: string;
}

/** Undiscovered features within reach of a settlement. */
function undiscoveredNear(gs: GameState, f: Feature, radius: number): { kind: string; name: string; x: number; y: number }[] {
  const k = gs.knowledge;
  return getWorld(gs.seed)
    .featuresNear(f.x, f.y, radius)
    .filter((x) => !k.discovered[`f:${x.x}:${x.y}`])
    .map((x) => ({ kind: x.kind, name: x.name, x: x.x, y: x.y }));
}

function featuresNearKind(gs: GameState, f: Feature, radius: number, kind: string): Feature[] {
  return getWorld(gs.seed)
    .featuresNear(f.x, f.y, radius)
    .filter((x) => x.kind === kind);
}

/** The nearest cave mouth within radius (a real opening in the real rock). */
function nearestMouth(gs: GameState, f: Feature, radius: number): { x: number; y: number } | null {
  const world = getWorld(gs.seed);
  const hf = heightOf(world);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = Math.max(0, f.y - radius); y <= Math.min(4095, f.y + radius); y += 2) {
    for (let x = Math.max(0, f.x - radius); x <= Math.min(4095, f.x + radius); x += 2) {
      if (!hf.isMouth(x, y)) continue;
      const d = Math.abs(x - f.x) + Math.abs(y - f.y);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** A genuinely dangerous local species — the region's own menace. */
function aggressiveSpecies(gs: GameState, f: Feature, salt: number): string | null {
  const world = getWorld(gs.seed);
  const biome = world.tile(f.x, f.y).biome;
  for (let s = 0; s < 6; s++) {
    const spId = world.pickSpecies(biome, hash2(settlementSeed(gs.seed, f) ^ 0x3d1f, salt + s * 17, s));
    if (spId && SPECIES[spId]?.aggression >= 0.5) return spId;
  }
  return null;
}

function rewardBase(difficulty: number, commissionFunded: boolean): Pick<ExpeditionReward, "gold" | "items"> {
  return {
    gold: Math.round((40 + difficulty * 45) * (commissionFunded ? 1.25 : 1)),
    items: difficulty >= 4 ? [{ id: "greater_tonic" as ItemId, n: 1 }] : [{ id: "tonic" as ItemId, n: 1 }],
  };
}

/* -------------------------------- Definitions --------------------------------- */

interface DefCtx {
  gs: GameState;
  f: Feature;
  rng: Rng;
  day: number;
  difficulty: number;
}

interface ExpeditionDef {
  id: string;
  category: ExpeditionCategory;
  /** Board pick weight. */
  weight: number;
  difficulty: number;
  minStanding: number;
  minParty: number;
  /** Binds the definition to this actual world; null = not offered here. */
  resolve(ctx: DefCtx): Resolved | null;
  /** Whose coin and whose name ride on this work (never the Guild's own ledger for reputation). */
  commission(ctx: DefCtx): ExpeditionOffer["commission"];
}

/**
 * The authored expedition definitions. Each one is a shape, not a place —
 * the destination comes from the player's own world at board time, so a
 * definition whose destination doesn't exist simply isn't posted there.
 */
export const EXPEDITION_DEFS: ExpeditionDef[] = [
  {
    id: "blank_spots",
    category: "exploration",
    weight: 30,
    difficulty: 1,
    minStanding: 0,
    minParty: 1,
    commission: (ctx) => ({ kind: "settlement", id: settlementId(ctx.f), name: ctx.f.name }),
    resolve: (ctx) => {
      const cands = undiscoveredNear(ctx.gs, ctx.f, 140);
      if (!cands.length) return null;
      const t = cands[ctx.rng.int(0, Math.min(2, cands.length - 1))];
      return {
        title: `Chart ${t.name}`,
        blurb: `${ctx.f.name} wants its maps honest. Somewhere out there stands ${t.name}, unrecorded. Walk there and put it on the record.`,
        destName: t.name,
        dest: { x: t.x, y: t.y },
        region: getWorld(ctx.gs.seed).regionName(t.x, t.y),
        objectives: [{ kind: "discover", label: `Discover ${t.name}`, target: { x: t.x, y: t.y, name: t.name }, count: 1, progress: 0 }],
        recommended: ["berries", "tonic"],
        minParty: 1,
      };
    },
  },
  {
    id: "vein_survey",
    category: "recovery",
    weight: 24,
    difficulty: 2,
    minStanding: 0,
    minParty: 1,
    commission: () => null,
    resolve: (ctx) => {
      const world = getWorld(ctx.gs.seed);
      const biome = world.tile(ctx.f.x, ctx.f.y).biome;
      const local = BIOMES[biome].forage.map(([id]) => id);
      const rare = local.find((i) => i === "ore" || i === "honeycomb");
      if (!rare) return null;
      const n = 3 + ctx.difficulty;
      return {
        title: `The ${ITEMS[rare].name} Survey`,
        blurb: `The Guild's records show ${rare === "ore" ? "workable stone" : "wild honey"} in the ${world.regionName(ctx.f.x, ctx.f.y)}. Bring back ${n} to confirm the find.`,
        destName: `the ${world.regionName(ctx.f.x, ctx.f.y)} wilds`,
        dest: { x: ctx.f.x, y: ctx.f.y },
        region: world.regionName(ctx.f.x, ctx.f.y),
        objectives: [{ kind: "gather", label: `Gather ${ITEMS[rare].name} ×${n}`, itemId: rare, count: n, progress: 0 }],
        recommended: ["tonic", "roasted_nuts"],
        minParty: 1,
      };
    },
  },
  {
    id: "silent_ruins",
    category: "investigation",
    weight: 20,
    difficulty: 3,
    minStanding: 5,
    minParty: 1,
    commission: () => null,
    resolve: (ctx) => {
      const world = getWorld(ctx.gs.seed);
      const k = ctx.gs.knowledge;
      const undiscovered = featuresNearKind(ctx.gs, ctx.f, 200, "ruin").filter((r) => !k.discovered[`f:${r.x}:${r.y}`]);
      const ruin = undiscovered[0] ?? featuresNearKind(ctx.gs, ctx.f, 200, "ruin")[0];
      if (!ruin) return null;
      const first = !k.discovered[`f:${ruin.x}:${ruin.y}`];
      const objectives: ExpeditionObjective[] = [];
      if (first) {
        objectives.push({ kind: "discover", label: `Discover ${ruin.name}`, target: { x: ruin.x, y: ruin.y, name: ruin.name }, count: 1, progress: 0 });
      }
      objectives.push({ kind: "reach", label: `Make the journey to ${ruin.name}`, target: { x: ruin.x, y: ruin.y, name: ruin.name }, count: 1, progress: 0 });
      objectives.push({
        kind: "investigate",
        label: `Search ${ruin.name} and record what the Guild should know`,
        target: { x: ruin.x, y: ruin.y, name: ruin.name },
        count: 1,
        progress: 0,
        prereq: objectives.length - 1,
      });
      return {
        title: `The ${ruin.name} Inquiry`,
        blurb: `Old stones keep their own counsel, but the Guild pays for eavesdropping. ${first ? `Find ${ruin.name}, ` : `Travel to ${ruin.name}, `}walk the ground, and search it properly.`,
        destName: ruin.name,
        dest: { x: ruin.x, y: ruin.y },
        region: world.regionName(ruin.x, ruin.y),
        objectives,
        recommended: ["tonic", "antidote"],
        minParty: 1,
      };
    },
  },
  {
    id: "hollow_dark",
    category: "investigation",
    weight: 18,
    difficulty: 3,
    minStanding: 5,
    minParty: 1,
    commission: () => null,
    resolve: (ctx) => {
      const world = getWorld(ctx.gs.seed);
      const mouth = nearestMouth(ctx.gs, ctx.f, 160);
      if (!mouth) return null;
      const threat = aggressiveSpecies(ctx.gs, ctx.f, 3);
      const objectives: ExpeditionObjective[] = [
        { kind: "reach", label: "Establish a safe route to the cave mouth", target: { x: mouth.x, y: mouth.y, name: "the cave mouth" }, count: 1, progress: 0 },
      ];
      if (threat) {
        objectives.push({
          kind: "defeat",
          label: `Thin the ${SPECIES[threat].name}s on the route`,
          speciesId: threat,
          count: 2,
          progress: 0,
          prereq: 0,
        });
      }
      return {
        title: "The Hollow Dark",
        blurb: `A cave mouth opens in the ${world.regionName(mouth.x, mouth.y)}, unmapped. Establish the route, and deal with whatever contests it.`,
        destName: "a cave mouth",
        dest: mouth,
        region: world.regionName(mouth.x, mouth.y),
        objectives,
        recommended: ["tonic", "draught"],
        minParty: 1,
      };
    },
  },
  {
    id: "den_of_thorns",
    category: "tracking",
    weight: 20,
    difficulty: 4,
    minStanding: 5,
    minParty: 2,
    commission: (ctx) => {
      // an association may fund dangerous fieldwork through the Guild —
      // its coin and its name, but the Guild still administers the work
      const fac = getFactions(ctx.gs.seed);
      const nation = fac.nationAt(ctx.f.x, ctx.f.y);
      const assoc = nation?.associations[0] ?? null;
      return assoc ? { kind: "assoc", id: assoc.id, name: assoc.name } : null;
    },
    resolve: (ctx) => {
      const spId = aggressiveSpecies(ctx.gs, ctx.f, 7);
      if (!spId) return null;
      const sp = SPECIES[spId];
      const world = getWorld(ctx.gs.seed);
      return {
        title: `Thin the ${sp.name} packs`,
        blurb: `${sp.name}s have grown bold in the ${world.regionName(ctx.f.x, ctx.f.y)}. The Guild's field record wants three fewer of them, taken cleanly.`,
        destName: `the ${world.regionName(ctx.f.x, ctx.f.y)} ranges`,
        dest: { x: ctx.f.x, y: ctx.f.y },
        region: world.regionName(ctx.f.x, ctx.f.y),
        objectives: [{ kind: "defeat", label: `Defeat 3 ${sp.name}s`, speciesId: spId, count: 3, progress: 0 }],
        recommended: ["draught", "greater_tonic"],
        minParty: 2,
      };
    },
  },
  {
    id: "sunken_relic",
    category: "artifact",
    weight: 14,
    difficulty: 4,
    minStanding: 10,
    minParty: 2,
    commission: () => null,
    resolve: (ctx) => {
      const world = getWorld(ctx.gs.seed);
      const ruins = featuresNearKind(ctx.gs, ctx.f, 220, "ruin");
      if (!ruins.length) return null;
      const ruin = ruins[ctx.rng.int(0, Math.min(1, ruins.length - 1))];
      return {
        title: `The ${ruin.name} Relic`,
        blurb: `The Guild's records hold a founder's note about ${ruin.name}: something was left there when the living moved on. Recover it.`,
        destName: ruin.name,
        dest: { x: ruin.x, y: ruin.y },
        region: world.regionName(ruin.x, ruin.y),
        objectives: [
          { kind: "reach", label: `Travel to ${ruin.name}`, target: { x: ruin.x, y: ruin.y, name: ruin.name }, count: 1, progress: 0 },
          { kind: "investigate", label: `Recover what ${ruin.name} still holds`, target: { x: ruin.x, y: ruin.y, name: ruin.name }, count: 1, progress: 0, prereq: 0 },
        ],
        recommended: ["greater_tonic", "antidote"],
        minParty: 2,
      };
    },
  },
  {
    id: "whispers",
    category: "legendary",
    weight: 8,
    difficulty: 5,
    minStanding: 15,
    minParty: 2,
    commission: () => null,
    resolve: (ctx) => {
      const world = getWorld(ctx.gs.seed);
      const lairs = featuresNearKind(ctx.gs, ctx.f, 260, "lair").filter((l) => {
        const rarity = l.speciesId ? SPECIES[l.speciesId]?.rarity : null;
        return rarity === "rare" || rarity === "legendary";
      });
      if (!lairs.length) return null;
      const lair = lairs[0];
      const sp = SPECIES[lair.speciesId!];
      return {
        title: `Whispers of a ${sp.name}`,
        blurb: `Settlers' letters mention a ${sp.name} in the ${world.regionName(lair.x, lair.y)}. The Guild does not pay for captures — it pays for the record. Go and see, and come back with the truth.`,
        destName: lair.name,
        dest: { x: lair.x, y: lair.y },
        region: world.regionName(lair.x, lair.y),
        objectives: [
          { kind: "reach", label: `Travel to ${lair.name}`, target: { x: lair.x, y: lair.y, name: lair.name }, count: 1, progress: 0 },
          { kind: "observe", label: `Observe the ${sp.name} and record it`, speciesId: lair.speciesId, count: 1, progress: 0, prereq: 0 },
        ],
        recommended: ["greater_tonic", "draught"],
        minParty: 2,
        clue: `A verified ${sp.name} sighting enters the Guild's records — the associations will hear of it within the season.`,
      };
    },
  },
];

/**
 * Validates an expedition definition's shape. Malformed definitions are
 * rejected safely — they can never reach a board.
 */
export function validateDef(def: unknown): string[] {
  const problems: string[] = [];
  if (typeof def !== "object" || def === null) return ["definition is not an object"];
  const d = def as Partial<ExpeditionDef> & { resolve?: unknown };
  if (typeof d.id !== "string" || !d.id) problems.push("id missing");
  if (typeof d.category !== "string") problems.push("category missing");
  if (typeof d.weight !== "number" || d.weight <= 0) problems.push("weight must be positive");
  if (typeof d.difficulty !== "number" || d.difficulty < 1 || d.difficulty > 5) problems.push("difficulty must be 1-5");
  if (typeof d.minStanding !== "number") problems.push("minStanding missing");
  if (typeof d.resolve !== "function") problems.push("resolve missing");
  return problems;
}

/* --------------------------------- The board ---------------------------------- */

/** The day's posted expeditions at one chapter. Deterministic in seed + chapter + day. */
export function guildOffers(gs: GameState, f: Feature): ExpeditionOffer[] {
  const chapter = gs.seed !== undefined ? [...getGuilds(gs.seed).values()].find((g) => g.settlement.x === f.x && g.settlement.y === f.y) : null;
  if (!chapter) return [];
  const es = expeditionState(gs);
  const key = chapter.id;
  const today = Math.floor(gs.tick / DAY_TICKS);
  const stored = es.offers?.[key];
  if (stored && stored.length && stored[0].postedDay === today) {
    return stored.filter((o) => o.status === "offered" && !es.declined?.[o.id]);
  }
  const fresh = generateOffers(gs, chapter.settlement, chapter, today);
  if (!es.offers) es.offers = {};
  es.offers[key] = fresh;
  return fresh;
}

function generateOffers(gs: GameState, f: Feature, chapter: { id: string; name: string }, day: number): ExpeditionOffer[] {
  const es = expeditionState(gs);
  const standing = standingOf(gs, chapter.id);
  const rng = new Rng(hash2(settlementSeed(gs.seed, f) ^ 0x3e1d, day, day * 7 + f.x));
  const out: ExpeditionOffer[] = [];
  const used = new Set<string>();
  for (let i = 0; i < BOARD_SLOTS; i++) {
    const pool = EXPEDITION_DEFS.filter((d) => !used.has(d.id) && d.minStanding <= standing);
    if (!pool.length) break;
    const total = pool.reduce((a, d) => a + d.weight, 0);
    let r = rng.next() * total;
    let def = pool[0];
    for (const d of pool) {
      r -= d.weight;
      if (r <= 0) {
        def = d;
        break;
      }
    }
    used.add(def.id);
    const difficulty = Math.min(5, def.difficulty + (rng.next() < 0.25 ? 1 : 0));
    const ctx: DefCtx = { gs, f, rng, day, difficulty };
    const res = def.resolve(ctx);
    if (!res) continue;
    if (es.declined?.[`${chapter.id}:${def.id}:${day}`]) continue;
    const commission = def.commission(ctx);
    const reward: ExpeditionReward = {
      ...rewardBase(difficulty, !!commission),
      standing: 2 + difficulty * 2,
      ...(commission?.kind === "assoc" ? { assocRep: { assocId: commission.id, delta: 2 + Math.floor(difficulty / 2) } } : {}),
      ...(commission?.kind === "settlement" ? { settlementRep: { key: commission.id, delta: 2 + Math.floor(difficulty / 2) } } : {}),
      ...(res.clue ? { clue: res.clue } : {}),
    };
    const offer: ExpeditionOffer = {
      id: `e:${chapter.id.slice(2)}:${day}:${i}`,
      defId: def.id,
      title: res.title,
      blurb: res.blurb,
      category: def.category,
      difficulty,
      guildKey: chapter.id,
      guildName: `${chapter.name} — ${GUILD_ORG}`,
      commission,
      destName: res.destName,
      dest: res.dest,
      region: res.region,
      postedDay: day,
      expiresDay: day + OFFER_DAYS,
      objectives: res.objectives,
      reward,
      recommended: res.recommended,
      minParty: Math.max(def.minParty, res.minParty),
      minStanding: def.minStanding,
      status: "offered",
    };
    out.push(offer);
  }
  return out;
}

/** Declines a posted offer — it stays declined for the day. */
export function declineExpedition(gs: GameState, offerId: string): void {
  const es = expeditionState(gs);
  for (const key in es.offers) {
    if (es.offers[key]?.some((o) => o.id === offerId)) {
      es.declined![offerId] = 1;
      return;
    }
  }
}

/* -------------------------------- Membership ---------------------------------- */

/**
 * Joins the chapter whose hall the player stands in. Membership is the
 * Guild's own roll — no association membership, tamer license or homestead
 * is asked about, and none is affected.
 */
export function joinGuild(gs: GameState): string | null {
  const es = expeditionState(gs);
  if (isMember(gs)) return "You are already enrolled in the Guild's rolls.";
  const world = getWorld(gs.seed);
  const here = world.siteAt(gs.player.x, gs.player.y);
  if (!here || !isSettlement(here)) return null;
  const f = world.tile(gs.player.x, gs.player.y).feature;
  if (!f || !isSettlement(f)) return null;
  const chapter = [...getGuilds(gs.seed).values()].find((g) => g.settlement.x === f.x && g.settlement.y === f.y);
  if (!chapter) return null;
  es.memberSince = gs.tick;
  addLog(gs, `Your name joins the rolls of ${chapter.name}, ${GUILD_ORG}. The clerk hands you a field notebook and a warning about the wet season.`, "good");
  return `Welcome to ${chapter.name}.`;
}

/* ------------------------------- Registration --------------------------------- */

export interface RegistrationResult {
  ok: boolean;
  msg: string;
}

/**
 * Registers an expedition: selects the party, reserves supplies, departs.
 * Fully validated before anything is consumed — a refused registration
 * costs nothing, a successful one deducts supplies exactly once.
 */
export function registerExpedition(gs: GameState, offerId: string, partyUids: string[], supplies: { id: ItemId; n: number }[]): RegistrationResult {
  const es = expeditionState(gs);
  if (!isMember(gs)) return { ok: false, msg: "Join the Guild's rolls before taking fieldwork." };
  if (es.active.some((a) => a.status === "active")) return { ok: false, msg: "One expedition at a time — the Guild's insurance is strict." };
  // find the offer on any chapter's current board
  let offer: ExpeditionOffer | null = null;
  for (const key in es.offers) {
    const o = es.offers[key]?.find((x) => x.id === offerId && x.status === "offered");
    if (o) offer = o;
  }
  if (!offer) return { ok: false, msg: "That work is no longer on the board." };
  const today = Math.floor(gs.tick / DAY_TICKS);
  if (today > offer.expiresDay) return { ok: false, msg: "The posting has lapsed — the board refreshes at dawn." };
  if (standingOf(gs, offer.guildKey) < offer.minStanding) return { ok: false, msg: "The Guild reserves that work for proven field names." };
  // party: real, alive, in the player's party, big enough
  if (partyUids.length < offer.minParty) return { ok: false, msg: `The Guild wants at least ${offer.minParty} monsters on this kind of work.` };
  const uids = new Set(gs.party.map((m) => m.uid));
  for (const uid of partyUids) {
    if (!uids.has(uid)) return { ok: false, msg: "Only monsters travelling in your party can be fielded." };
    const mon = gs.party.find((m) => m.uid === uid)!;
    if (mon.hp <= 0) return { ok: false, msg: `${mon.nickname ?? SPECIES[mon.speciesId].name} is in no condition to travel.` };
  }
  // supplies: real items, really in the bag — validated before anything moves
  const wants: Partial<Record<ItemId, number>> = {};
  for (const s of supplies) {
    if (s.n <= 0) return { ok: false, msg: "Supplies must be a positive number." };
    if (!SUPPLY_ITEMS.includes(s.id)) return { ok: false, msg: `${ITEMS[s.id]?.name ?? s.id} is not expedition supply.` };
    wants[s.id] = (wants[s.id] ?? 0) + s.n;
  }
  for (const id in wants) {
    if ((gs.bag[id as ItemId] ?? 0) < wants[id]!) return { ok: false, msg: `You don't have ${wants[id]}× ${ITEMS[id as ItemId].name}.` };
  }
  // everything checks: deduct supplies, take the offer off the board, depart
  const taken: { id: ItemId; n: number }[] = [];
  for (const id in wants) {
    const itemId = id as ItemId;
    gs.bag[itemId] = (gs.bag[itemId] ?? 0) - wants[itemId]!;
    if (gs.bag[itemId]! <= 0) delete gs.bag[itemId];
    taken.push({ id: itemId, n: wants[itemId]! });
  }
  for (const key in es.offers) {
    const arr = es.offers[key];
    const o = arr?.find((x) => x.id === offerId);
    if (o) o.status = "active";
  }
  es.seq = (es.seq ?? 0) + 1;
  const instance: ExpeditionInstance = {
    offer: { ...offer, objectives: offer.objectives.map((o) => ({ ...o })) },
    party: [...partyUids],
    supplies: taken,
    consumed: [],
    startDay: today,
    deadlineDay: today + 4 + (5 - offer.difficulty),
    complications: 0,
    status: "active",
  };
  es.active.push(instance);
  addLog(gs, `Expedition underway: "${offer.title}". The Guild's clerk marks the deadline in your notebook.`, "event");
  return { ok: true, msg: `Expedition registered: ${offer.title}.` };
}

/* ----------------------------- Objective progress ------------------------------ */

function prereqDone(inst: ExpeditionInstance, o: ExpeditionObjective): boolean {
  return o.prereq === undefined || (inst.offer.objectives[o.prereq]?.progress ?? 0) >= (inst.offer.objectives[o.prereq]?.count ?? 1);
}

/** Advances one objective by n if it matches; logs completion and overall readiness exactly once. */
function advance(inst: ExpeditionInstance, o: ExpeditionObjective, n: number, gs: GameState): void {
  if (o.progress >= o.count || !prereqDone(inst, o)) return;
  o.progress = Math.min(o.count, o.progress + n);
  if (o.progress >= o.count) {
    addLog(gs, `Guild record: ${o.label} — done.`, "good");
    if (inst.offer.objectives.every((x) => x.progress >= x.count)) {
      addLog(gs, `All objectives met for "${inst.offer.title}" — return to the ${inst.offer.guildName.split(" — ")[0]} to settle the record.`, "good");
    }
  }
}

function activeInst(gs: GameState, expId: string): ExpeditionInstance | null {
  return gs.expeditions?.active.find((a) => a.offer.id === expId && a.status === "active") ?? null;
}

/** A real first discovery — discover objectives progress on the genuine article only. */
export function onExpeditionDiscover(gs: GameState, x: number, y: number): void {
  if (!gs.expeditions?.active.length) return;
  for (const inst of gs.expeditions.active) {
    if (inst.status !== "active") continue;
    for (const o of inst.offer.objectives) {
      if (o.kind === "discover" && o.target && o.target.x === x && o.target.y === y) advance(inst, o, 1, gs);
    }
  }
}

/** A real forage — gather objectives progress by what was actually gathered. */
export function onExpeditionForage(gs: GameState, itemId: ItemId, n: number): void {
  if (!gs.expeditions?.active.length) return;
  for (const inst of gs.expeditions.active) {
    if (inst.status !== "active") continue;
    for (const o of inst.offer.objectives) {
      if (o.kind === "gather" && o.itemId === itemId) advance(inst, o, n, gs);
    }
  }
}

/** A real kill — defeat objectives progress by the species actually felled. */
export function onExpeditionKill(gs: GameState, speciesId: string): void {
  if (!gs.expeditions?.active.length) return;
  for (const inst of gs.expeditions.active) {
    if (inst.status !== "active") continue;
    for (const o of inst.offer.objectives) {
      if (o.kind === "defeat" && o.speciesId === speciesId) advance(inst, o, 1, gs);
    }
  }
}

/** A real ruin search — investigate objectives progress at the ruin actually searched. */
export function onExpeditionInvestigate(gs: GameState, x: number, y: number): void {
  if (!gs.expeditions?.active.length) return;
  for (const inst of gs.expeditions.active) {
    if (inst.status !== "active") continue;
    for (const o of inst.offer.objectives) {
      if (o.kind === "investigate" && o.target && o.target.x === x && o.target.y === y) advance(inst, o, 1, gs);
    }
  }
}

/**
 * Per-tick world checks: reaching destinations, sighting species. Returns a
 * complication to spawn (sim side spawns and engages it through the one
 * combat system), or null.
 */
export function tickExpeditions(gs: GameState): { speciesId: string; level: number; x: number; y: number } | null {
  const insts = gs.expeditions?.active.filter((a) => a.status === "active");
  if (!insts?.length) return null;
  const world = getWorld(gs.seed);
  const sight = sightRadius(gs);
  for (const inst of insts) {
    for (const o of inst.offer.objectives) {
      if (o.progress >= o.count || !prereqDone(inst, o)) continue;
      if (o.kind === "reach" && o.target) {
        if (Math.max(Math.abs(gs.player.x - o.target.x), Math.abs(gs.player.y - o.target.y)) <= 3) {
          advance(inst, o, 1, gs);
          // arriving in dangerous country can go badly: a field complication,
          // met through the one combat system the world already runs
          const chance = 0.3 + inst.offer.difficulty * 0.08;
          const roll = ((hash2(gs.seed ^ 0x51ab, gs.tick, inst.startDay) >>> 8) % 1000) / 1000;
          if (inst.complications < 2 && roll < chance) {
            const biome = world.tile(gs.player.x, gs.player.y).biome;
            const spId = world.pickSpecies(biome, hash2(gs.seed ^ 0x9d4a, gs.tick, inst.startDay)) ?? Object.keys(SPECIES)[0];
            inst.complications += 1;
            addLog(gs, "Something has the smell of your party and no fear of it.", "bad");
            return { speciesId: spId, level: 3 + inst.offer.difficulty * 2, x: gs.player.x, y: gs.player.y };
          }
        }
      }
      if (o.kind === "observe" && o.speciesId) {
        for (const c of Object.values(gs.creatures)) {
          if (c.speciesId !== o.speciesId || (c.layer ?? 0) !== (gs.player.layer ?? 0)) continue;
          if (Math.abs(c.x - gs.player.x) > sight || Math.abs(c.y - gs.player.y) > sight) continue;
          advance(inst, o, 1, gs);
          break;
        }
      }
    }
  }
  return null;
}

/** Daily housekeeping: deadlines lapse into failure (partial payout, discoveries kept). */
export function advanceExpeditions(gs: GameState): void {
  const es = expeditionState(gs);
  const today = Math.floor(gs.tick / DAY_TICKS);
  for (const inst of [...es.active]) {
    if (inst.status !== "active") continue;
    if (today > inst.deadlineDay) resolveIncomplete(gs, inst, "failed", "The deadline passed — the Guild closes the file with a note about weather and excuses.");
  }
}

function resolveIncomplete(gs: GameState, inst: ExpeditionInstance, outcome: "failed" | "abandoned", note: string): void {
  const es = expeditionState(gs);
  inst.status = outcome;
  const done = inst.offer.objectives.filter((o) => o.progress >= o.count).length;
  const total = inst.offer.objectives.length;
  // partial purse for genuinely finished objectives; discoveries already
  // made keep themselves (they live in the player's knowledge, not here)
  const frac = total ? done / total : 0;
  let partial = 0;
  if (frac >= PARTIAL_FRACTION) partial = Math.floor(inst.offer.reward.gold * frac * PARTIAL_FRACTION);
  gs.player.gold += partial;
  const rewardsText = partial > 0 ? `Partial purse: ${partial} gold for ${done}/${total} objectives.` : "No pay — the Guild does not fund unfinished work.";
  if (partial > 0) addLog(gs, `The Guild pays a partial purse for the objectives you did meet.`, "info");
  addLog(gs, note, "info");
  es.active = es.active.filter((a) => a !== inst);
  es.history.push({
    offer: inst.offer,
    party: inst.party,
    outcome,
    day: Math.floor(gs.tick / DAY_TICKS),
    objectivesDone: done,
    objectivesTotal: total,
    rewardsText,
  });
  while (es.history.length > HISTORY_MAX) es.history.shift();
}

/* ---------------------------------- Outcomes ----------------------------------- */

/** Whether every objective of this expedition is fully progressed. */
export function expeditionDone(inst: ExpeditionInstance): boolean {
  return inst.offer.objectives.every((o) => o.progress >= o.count);
}

/** Whether the player stands at the issuing chapter's settlement. */
export function atIssuingGuild(gs: GameState, inst: ExpeditionInstance): boolean {
  const chapter = guildByKey(gs.seed, inst.offer.guildKey);
  if (!chapter) return false;
  const world = getWorld(gs.seed);
  const f = world.siteAt(gs.player.x, gs.player.y)?.feature;
  return !!f && isSettlement(f) && f.x === chapter.settlement.x && f.y === chapter.settlement.y;
}

/**
 * Settles the record at the issuing chapter. Pays exactly once — the status
 * transition is the guard, and every ledger application carries its own
 * idempotency key, so a reload mid-payout can never pay twice.
 */
export function claimExpedition(gs: GameState, expId: string): string | null {
  const es = expeditionState(gs);
  const inst = es.active.find((a) => a.offer.id === expId && a.status === "active");
  if (!inst) return null;
  if (!atIssuingGuild(gs, inst)) return `Return to the ${inst.offer.guildName.split(" — ")[0]} to settle this expedition.`;
  if (!expeditionDone(inst)) return "The work is not finished yet — the Guild pays for records, not intentions.";
  const r = inst.offer.reward;
  // pay out exactly once: the transition happens before any ledger math
  inst.status = "completed";
  inst.claimed = true;
  gs.player.gold += r.gold;
  const itemLines: string[] = [];
  for (const it of r.items) {
    gs.bag[it.id] = (gs.bag[it.id] ?? 0) + it.n;
    itemLines.push(`${it.n}× ${ITEMS[it.id].name}`);
  }
  // the Guild's own ledger, keyed to this expedition — never association coin
  applyOrgStanding(gs, "player", "guilds", inst.offer.guildKey, r.standing, `exp:${inst.offer.id}`);
  if (r.assocRep) applyOrgStanding(gs, "player", "assocs", r.assocRep.assocId, r.assocRep.delta, `exp:${inst.offer.id}:assoc`);
  if (r.settlementRep) applyOrgStanding(gs, "player", "settlements", r.settlementRep.key, r.settlementRep.delta, `exp:${inst.offer.id}:settle`);
  if (r.clue) addLog(gs, r.clue, "event");
  addLog(gs, `Expedition complete: "${inst.offer.title}". +${r.gold} gold${itemLines.length ? `, ${itemLines.join(", ")}` : ""}. Guild standing rises.`, "good");
  const es2 = expeditionState(gs);
  es2.active = es2.active.filter((a) => a !== inst);
  es2.history.push({
    offer: inst.offer,
    party: inst.party,
    outcome: "completed",
    day: Math.floor(gs.tick / DAY_TICKS),
    objectivesDone: inst.offer.objectives.length,
    objectivesTotal: inst.offer.objectives.length,
    rewardsText: `${r.gold} gold${itemLines.length ? `, ${itemLines.join(", ")}` : ""}; +${r.standing} standing.`,
  });
  while (es2.history.length > HISTORY_MAX) es2.history.shift();
  return `Expedition complete: ${inst.offer.title}.`;
}

/** Walks away — discoveries and finished objectives stay in the record. */
export function abandonExpedition(gs: GameState, expId: string): string | null {
  const inst = activeInst(gs, expId);
  if (!inst) return null;
  resolveIncomplete(gs, inst, "abandoned", `You walk away from "${inst.offer.title}". The Guild keeps the record of what you did find.`);
  return `Expedition abandoned: ${inst.offer.title}.`;
}

/* ------------------------------ En-route supplies ------------------------------ */

/**
 * Spends one unit of the given supply from the expedition's locker (not the
 * bag — it left the bag at departure) and applies it through the existing
 * item system by routing it through the bag for one call. Returns a message,
 * or null when the locker is empty.
 */
export function useExpeditionSupply(gs: GameState, expId: string, itemId: ItemId, apply: (gs: GameState, itemId: ItemId) => string | null): string | null {
  const inst = activeInst(gs, expId);
  if (!inst) return null;
  const slot = inst.supplies.find((s) => s.id === itemId && s.n > 0);
  if (!slot) return null;
  // route through the bag so the one item system does the work
  gs.bag[itemId] = (gs.bag[itemId] ?? 0) + 1;
  const msg = apply(gs, itemId);
  if (msg === null) {
    // nothing happened: put it back
    gs.bag[itemId] = (gs.bag[itemId] ?? 0) - 1;
    if (gs.bag[itemId]! <= 0) delete gs.bag[itemId];
    return null;
  }
  slot.n -= 1;
  inst.consumed.push({ id: itemId, n: 1 });
  if (slot.n <= 0) inst.supplies = inst.supplies.filter((s) => s !== slot);
  return msg;
}

/* --------------------------------- Migration ----------------------------------- */

/** Save migration (v30): Guild state backfilled empty for older saves — nothing existing is touched. */
export function migrateExpeditions(gs: GameState): void {
  expeditionState(gs);
}

/* --------------------------- Preparation assessment ----------------------------- */

export interface AssessLine {
  text: string;
  tone: "good" | "warn" | "info";
}

/**
 * The clerk's read on a field party: what the monsters actually are — real
 * traits, real sizes, real swimmers, real condition — weighed against the
 * destination the offer names. Informative, never a gate: the Guild pays for
 * records, not for safety, and registration rules stay in registerExpedition.
 */
export function partyAssessment(gs: GameState, offer: ExpeditionOffer, partyUids: string[]): AssessLine[] {
  const lines: AssessLine[] = [];
  const mons = partyUids
    .map((u) => gs.party.find((m) => m.uid === u))
    .filter((m): m is NonNullable<ReturnType<typeof gs.party.find>> => m !== undefined);
  // conditioning against the difficulty the posting carries
  if (mons.length) {
    const avg = Math.round(mons.reduce((a, m) => a + m.level, 0) / mons.length);
    const suggested = 2 + offer.difficulty * 3;
    lines.push(
      avg >= suggested
        ? { text: `Party averages level ${avg} — the work wants about ${suggested}.`, tone: "good" }
        : { text: `Party averages level ${avg}; the work wants about ${suggested}. The clerk says nothing, but writes it down.`, tone: "warn" },
    );
  }
  // what the destination demands of the party, from the real map tile
  const biome = getWorld(gs.seed).tile(offer.dest.x, offer.dest.y).biome;
  const dark = biome === "mountain" || biome === "taiga" || biome === "gloomwood";
  const has = (m: { speciesId: string }, t: TraitId): boolean => SPECIES[m.speciesId]?.traits?.includes(t) ?? false;
  if (mons.some((m) => has(m, "flutter"))) lines.push({ text: "A wing in the party can scout the broken ground and spot the route on.", tone: "good" });
  if (mons.some((m) => SPECIES[m.speciesId]?.swims)) lines.push({ text: "A strong swimmer aboard — the water on this ground won't be the problem.", tone: "good" });
  if (mons.some((m) => (SPECIES[m.speciesId]?.size ?? 1) >= 2)) lines.push({ text: "A big frame can force obstacles and hold a bad encounter.", tone: "good" });
  if (mons.some((m) => (SPECIES[m.speciesId]?.size ?? 1) === 1)) lines.push({ text: "Small frames fit the narrow ways ruins and caves keep.", tone: "info" });
  if (dark && mons.some((m) => has(m, "night_eyes"))) lines.push({ text: "Night eyes, where this country keeps its own dark.", tone: "good" });
  // condition: the field forgives nothing, and the clerk knows it
  const hurt = mons.filter((m) => m.hp > 0 && m.hp < (statOf(m, "hp") ?? 1) / 2);
  if (hurt.length) lines.push({ text: `${hurt.length} of the field party are already hurt — the wilds rarely improve them.`, tone: "warn" });
  return lines;
}
