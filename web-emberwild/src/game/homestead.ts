/**
 * The Monster Homestead (Update C) — permanent property and its facilities.
 *
 * A homestead is one plot of land bought from a settlement's innkeep. It is
 * real world geography: a passable tile just outside the settlement walls the
 * player can walk to, where the Homestead sheet opens.
 *
 * Architecture, in the established pattern:
 *  - this module is pure (never imports sim.ts) — actions here mutate state
 *    and return results; sim.ts wrappers add ticks and log lines;
 *  - facilities are data-driven (FACILITIES registry) so future buildings
 *    (kitchen, workshop, garden, ...) are definitions, not new systems;
 *  - nothing here duplicates an existing system: pens ARE gs.pen, breeding
 *    uses the existing previewBreeding/requestBreeding path, nursery eggs
 *    stay in gs.eggs with one incubation clock — facilities only raise
 *    capacities and open existing mechanics at the homestead;
 *  - construction advances with simulation time: a job stores the tick it
 *    completes at, and the facility takes effect once gs.tick passes it.
 */
import { BIOMES, DAY_TICKS, ITEMS, PEN_MAX, WORLD_SIZE } from "./data";
// NOTE: no eggs.ts import here — eggs.ts imports breeding.ts, and breeding.ts
// needs penCapacityOf from this module; gs.eggs is read directly instead.
import { roadAt } from "./roads";
import { getSettlementFootprint } from "./settlement";
import { getWorld } from "./world";
import type { CarriedEgg, FacilityState, GameState, HomesteadState, ItemId } from "./types";

/** A build/upgrade price: coin up front plus materials out of the bag. */
export interface FacilityCost {
  gold: number;
  items: Partial<Record<ItemId, number>>;
}

export interface FacilityDef {
  id: string;
  name: string;
  glyph: string;
  blurb: string;
  /** What the facility grants; effects scale with the completed level. */
  effects: { penCapacity?: number; storageCapacity?: number; nurserySlots?: number; breedingGrounds?: boolean };
  /** Sim ticks each level's construction takes. */
  buildTicks: number;
  /** Highest level this facility reaches. */
  maxLevel: number;
  /** Cost per level; index = level - 1. */
  costs: FacilityCost[];
  /** Defined for the future but not yet constructible. */
  future?: boolean;
}

const C = (gold: number, items: Partial<Record<ItemId, number>> = {}): FacilityCost => ({ gold, items });

/** The facility registry. Pens, cellar, breeding grounds and nursery are live; the rest await future updates. */
export const FACILITIES: Record<string, FacilityDef> = {
  pens: {
    id: "pens",
    name: "Monster Pens",
    glyph: "Ω",
    blurb: "Sturdy fenced runs and shaded shelters. Each level houses six more monsters.",
    effects: { penCapacity: 6 },
    buildTicks: 8 * 12,
    maxLevel: 3,
    costs: [C(40, { ore: 4 }), C(80, { ore: 8, honeycomb: 2 }), C(140, { ore: 12, honeycomb: 4 })],
  },
  storage: {
    id: "storage",
    name: "Root Cellar",
    glyph: "▤",
    blurb: "Cool, dry and rat-proof. Each level stores eighty more items.",
    effects: { storageCapacity: 80 },
    buildTicks: 6 * 12,
    maxLevel: 3,
    costs: [C(25, { ore: 3 }), C(60, { ore: 6, herb: 3 }), C(100, { ore: 10, herb: 5 })],
  },
  breeding: {
    id: "breeding",
    name: "Breeding Grounds",
    glyph: "♥",
    blurb: "A quiet green hollow where compatible monsters may pair — the same rites the shrines keep.",
    effects: { breedingGrounds: true },
    buildTicks: 8 * 12,
    maxLevel: 1,
    costs: [C(60, { ore: 5, honeycomb: 2 })],
  },
  nursery: {
    id: "nursery",
    name: "Hatchery Nursery",
    glyph: "◍",
    blurb: "Sand-warmed racks where eggs incubate safely. Each level holds two more eggs and frees the pack.",
    effects: { nurserySlots: 2 },
    buildTicks: 6 * 12,
    maxLevel: 2,
    costs: [C(45, { ore: 4, honeycomb: 2 }), C(90, { ore: 8, honeycomb: 4 })],
  },
  // ---- future facilities: defined now, constructible in a later update ----
  kitchen: {
    id: "kitchen",
    name: "Homestead Kitchen",
    glyph: "♨",
    blurb: "A proper hearth of one's own. (Planned — cooking stays camp-based for now.)",
    effects: {},
    buildTicks: 0,
    maxLevel: 1,
    costs: [],
    future: true,
  },
  workshop: {
    id: "workshop",
    name: "Workshop",
    glyph: "⚒",
    blurb: "A bench for finer work. (Planned — crafting stays camp-based for now.)",
    effects: {},
    buildTicks: 0,
    maxLevel: 1,
    costs: [],
    future: true,
  },
  garden: {
    id: "garden",
    name: "Kitchen Garden",
    glyph: "♣",
    blurb: "Tended rows of roots and greens. (Planned.)",
    effects: {},
    buildTicks: 0,
    maxLevel: 1,
    costs: [],
    future: true,
  },
  training: {
    id: "training",
    name: "Training Yard",
    glyph: "⚔",
    blurb: "Dummies, rings and room to drill. (Planned.)",
    effects: {},
    buildTicks: 0,
    maxLevel: 1,
    costs: [],
    future: true,
  },
  recovery: {
    id: "recovery",
    name: "Recovery Den",
    glyph: "♥",
    blurb: "Warm sand and quiet dark for the badly hurt. (Planned.)",
    effects: {},
    buildTicks: 0,
    maxLevel: 1,
    costs: [],
    future: true,
  },
};

/** Price of buying the plot itself from a settlement's innkeep. */
export const PLOT_COST: FacilityCost = C(120, { ore: 4 });

/* --------------------------------- helpers ---------------------------------- */

export function homesteadOf(gs: GameState): HomesteadState | undefined {
  return gs.homestead;
}

export function facilityOf(h: HomesteadState, id: string): FacilityState | undefined {
  return h.facilities[id];
}

/** Completed level of a facility (a level under construction does not count yet). */
export function facilityLevel(h: HomesteadState, id: string): number {
  return h.facilities[id]?.level ?? 0;
}

/** Promotes finished construction jobs — idempotent, safe to run every tick. */
export function settleFacilities(gs: GameState): void {
  const h = gs.homestead;
  if (!h) return;
  for (const f of Object.values(h.facilities)) {
    if (f.building && gs.tick >= (f.completeTick ?? Infinity)) {
      f.level = f.building;
      f.building = undefined;
      f.completeTick = undefined;
    }
  }
}

/** Time-aware level read: settles finished construction first. */
export function levelOf(gs: GameState, id: string): number {
  if (!gs.homestead) return 0;
  settleFacilities(gs);
  return facilityLevel(gs.homestead, id);
}

/** Total pen capacity: the base every tamer has, plus homestead pens. */
export function penCapacityOf(gs: GameState): number {
  return PEN_MAX + levelOf(gs, "pens") * (FACILITIES.pens.effects.penCapacity ?? 0);
}

/** How much the cellar can hold, in items. */
export function storageCapacityOf(gs: GameState): number {
  return levelOf(gs, "storage") * (FACILITIES.storage.effects.storageCapacity ?? 0);
}

/** How many eggs the nursery racks hold. */
export function nurseryCapacityOf(gs: GameState): number {
  return levelOf(gs, "nursery") * (FACILITIES.nursery.effects.nurserySlots ?? 0);
}

export function storageUsedOf(gs: GameState): number {
  const storage = gs.homestead?.storage ?? {};
  let n = 0;
  for (const count of Object.values(storage)) n += count ?? 0;
  return n;
}

/** Eggs resting in the homestead nursery. */
export function nurseryEggs(gs: GameState): CarriedEgg[] {
  return (gs.eggs ?? []).filter((e) => e.homestead);
}

/** Eggs riding in the pack proper (nursery eggs free their slots). */
export function packEggCount(gs: GameState): number {
  return (gs.eggs ?? []).filter((e) => !e.homestead).length;
}

/**
 * Whether the player stands on their homestead — inside the property bounds
 * (Update C.1), or near the raw plot for a not-yet-migrated save.
 */
export function isAtHomestead(gs: GameState, radius = 2): boolean {
  const h = gs.homestead;
  if (!h) return false;
  if (h.property) {
    const p = h.property;
    return gs.player.x >= p.x - 1 && gs.player.x < p.x + p.w + 1 && gs.player.y >= p.y - 1 && gs.player.y < p.y + p.h + 1;
  }
  const dx = Math.abs(gs.player.x - h.x);
  const dy = Math.abs(gs.player.y - h.y);
  return dx <= radius && dy <= radius;
}

/* ---------------------------------- costs ----------------------------------- */

export function canAfford(gs: GameState, cost: FacilityCost): boolean {
  if (gs.player.gold < cost.gold) return false;
  for (const [id, n] of Object.entries(cost.items)) if ((gs.bag[id as ItemId] ?? 0) < (n ?? 0)) return false;
  return true;
}

/** Atomically consumes the price. Only call after canAfford. */
export function payCost(gs: GameState, cost: FacilityCost): void {
  gs.player.gold -= cost.gold;
  for (const [id, n] of Object.entries(cost.items)) {
    const left = (gs.bag[id as ItemId] ?? 0) - (n ?? 0);
    if (left > 0) gs.bag[id as ItemId] = left;
    else delete gs.bag[id as ItemId];
  }
}

/** Short human summary of a price, for buttons. */
export function costLabel(cost: FacilityCost): string {
  const parts = [`${cost.gold}g`];
  for (const [id, n] of Object.entries(cost.items)) parts.push(`${n} ${ITEMS[id as ItemId].name}`);
  return parts.join(" + ");
}

/* -------------------------------- plot place -------------------------------- */

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/**
 * True when a tile can take a floor or wall — the same rule
 * homesteadBuildings.tileObstruction applies (mirrored here because that
 * module already imports this one): water, site pieces and roads are
 * absolute; trees, shrubs and rocks are cleared by construction.
 */
function tileBuildable(world: ReturnType<typeof getWorld>, x: number, y: number): boolean {
  const t = world.tile(x, y);
  if (!BIOMES[t.biome].passable) return false;
  if (world.siteAt(x, y)) return false;
  if (roadAt(world, x, y)) return false;
  return true;
}

/** The 17×17 property rect a plot at (px,py) anchors, extending away from the settlement — mirrors propertyRectOf's derivation. */
function propertyRectForPlot(px: number, py: number, sx: number, sy: number): { x: number; y: number; w: number; h: number } {
  const dx = px - sx;
  const dy = py - sy;
  let x0 = dx > 0 ? px : dx < 0 ? px - (17 - 1) : px;
  let y0 = dy > 0 ? py : dy < 0 ? py - (17 - 1) : py;
  x0 = Math.max(0, Math.min(x0, WORLD_SIZE - 17));
  y0 = Math.max(0, Math.min(y0, WORLD_SIZE - 17));
  return { x: x0, y: y0, w: 17, h: 17 };
}

/**
 * How many cottage-sized (7×6) fully clear building windows the plot's whole
 * property contains — a proxy for "land you can actually build on". Update
 * C.2 blocks construction on trees, rocks, roads and site pieces, so a plot
 * whose ground is choked is worthless no matter how clear the plot tile
 * itself is.
 */
function plotClearScore(world: ReturnType<typeof getWorld>, px: number, py: number, sx: number, sy: number): number {
  const r = propertyRectForPlot(px, py, sx, sy);
  let score = 0;
  for (let y = r.y; y + 6 <= r.y + r.h; y++) {
    for (let x = r.x; x + 7 <= r.x + r.w; x++) {
      let clear = true;
      for (let yy = y; yy < y + 6 && clear; yy++) {
        for (let xx = x; xx < x + 7 && clear; xx++) {
          if (!tileBuildable(world, xx, yy)) clear = false;
        }
      }
      if (clear) score++;
    }
  }
  return score;
}

/**
 * Finds the homestead plot: a passable, unclaimed tile on a ring just outside
 * the settlement footprint whose whole property holds genuinely buildable
 * ground (a pure function of the world, so the same settlement always grants
 * the same plot). Falls back to the first physically clear tile when no ring
 * tile has buildable ground.
 */
export function findPlot(seed: number, sx: number, sy: number, tier: "hamlet" | "town" | "city"): { x: number; y: number } | null {
  const world = getWorld(seed);
  const fp = getSettlementFootprint(tier);
  const start = Math.ceil(Math.max(fp.w, fp.h) / 2) + 2;
  const ringOrder: { x: number; y: number }[] = [];
  for (let r = start; r < start + 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) continue;
        if (world.siteAt(x, y)) continue;
        if (!BIOMES[world.tile(x, y).biome].passable) continue;
        ringOrder.push({ x, y });
      }
    }
    // prefer the first ring with buildable ground; within a ring, the most
    // buildable plot wins (scan order breaks ties)
    if (ringOrder.length > 0) {
      let best: { x: number; y: number } | null = null;
      let bestScore = 0;
      for (const c of ringOrder) {
        const s = plotClearScore(world, c.x, c.y, sx, sy);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      if (best) return best;
    }
  }
  return ringOrder[0] ?? null;
}

/* ------------------------------- migration ---------------------------------- */

/** Idempotent save migration: older saves simply have no homestead; torn or partial state is repaired. */
export function migrateHomestead(gs: GameState): void {
  const h = gs.homestead;
  if (!h) return;
  if (typeof h.id !== "string" || typeof h.x !== "number" || typeof h.y !== "number" || !h.settlement) {
    // a deed without geography is not a deed — drop it rather than half-load
    delete gs.homestead;
    return;
  }
  h.name = h.name || `${h.settlement.name} Homestead`;
  h.facilities ??= {};
  h.storage ??= {};
  for (const f of Object.values(h.facilities)) {
    f.level = Math.max(0, f.level ?? 0);
    if (!f.building || !f.completeTick) {
      f.building = undefined;
      f.completeTick = undefined;
    }
  }
}

/* ------------------------------- construction ------------------------------- */

/**
 * Starts or continues a build/upgrade. Returns a result string; "" means the
 * state rejected the action with a spoken reason already returned.
 */
export function startConstruction(gs: GameState, id: string): string {
  const h = gs.homestead;
  settleFacilities(gs);
  if (!h) return "You own no homestead yet.";
  const def = FACILITIES[id];
  if (!def || def.future) return "That is not something you can build yet.";
  let f = h.facilities[id];
  if (f?.building && gs.tick < (f.completeTick ?? 0)) {
    const days = Math.max(1, Math.ceil(((f.completeTick ?? 0) - gs.tick) / DAY_TICKS));
    return `The ${def.name.toLowerCase()} is still being raised — about ${days} more ${days === 1 ? "day" : "days"}.`;
  }
  if (!f) {
    f = { level: 0 };
    h.facilities[id] = f;
  }
  const nextLevel = f.level + 1;
  if (nextLevel > def.maxLevel) return `The ${def.name.toLowerCase()} is already at its finest.`;
  const cost = def.costs[nextLevel - 1];
  if (!canAfford(gs, cost)) return `You lack the means — the ${def.name.toLowerCase()} wants ${costLabel(cost).toLowerCase()}.`;
  payCost(gs, cost);
  f.building = nextLevel;
  f.completeTick = gs.tick + def.buildTicks;
  return "";
}
