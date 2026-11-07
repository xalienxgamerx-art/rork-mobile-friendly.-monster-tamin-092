/**
 * Update C.1 — Modular Homestead Construction and Room Design.
 *
 * Homestead buildings are prefab structures placed freely on the property's
 * real world tiles. Every building is a set of rooms; every room can be given
 * a designation (bedroom, kitchen, storage …) bought once as a permanent,
 * homestead-wide designation set. Furniture is auto-generated from the room's
 * designation, dimensions and style. Room functions are gated on physical
 * presence: the player must stand inside the room itself.
 *
 *  - this module is pure (never imports sim.ts) — actions here mutate state
 *    and return "" on success or a spoken refusal.
 *  - Facility LEVELS (Update C) stay authoritative for capacity; rooms gate
 *    physical access to the functions those capacities serve.
 */

import { BIOMES, WORLD_SIZE } from "./data";
import { objectAt, OBJ_NAME } from "./objects";
import { roadAt } from "./roads";
import { getWorld } from "./world";
import { canAfford, costLabel, payCost, type FacilityCost } from "./homestead";
import { hash01, hashString } from "./rng";
import type {
  BuildingRecord,
  Doorway,
  FurnitureItem,
  GameState,
  Rect,
  RoomDesignation,
  RoomFacility,
  RoomRecord,
} from "./types";

/* --------------------------------- helpers --------------------------------- */

const c = (gold: number, items: Partial<Record<string, number>> = {}): FacilityCost => ({
  gold,
  items: items as FacilityCost["items"],
});

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

function unionOf(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* --------------------------------- property -------------------------------- */

export const PROPERTY_SIZE = 17;

/**
 * The walkable property bounds: a square of land anchored at the plot tile,
 * extending away from the settlement. Stored on the homestead (and backfilled
 * by migration); derived deterministically when absent.
 */
export function propertyRectOf(gs: GameState): Rect | null {
  const h = gs.homestead;
  if (!h) return null;
  if (h.property) return h.property;
  const dx = h.x - h.settlement.x;
  const dy = h.y - h.settlement.y;
  let x0 = dx > 0 ? h.x : dx < 0 ? h.x - (PROPERTY_SIZE - 1) : h.x;
  let y0 = dy > 0 ? h.y : dy < 0 ? h.y - (PROPERTY_SIZE - 1) : h.y;
  x0 = Math.max(0, Math.min(x0, WORLD_SIZE - PROPERTY_SIZE));
  y0 = Math.max(0, Math.min(y0, WORLD_SIZE - PROPERTY_SIZE));
  const r = { x: x0, y: y0, w: PROPERTY_SIZE, h: PROPERTY_SIZE };
  h.property = r;
  return r;
}

/** True when the player stands anywhere on their homestead property. */
export function onProperty(gs: GameState): boolean {
  const p = propertyRectOf(gs);
  return !!p && rectContains(grow(p, 0), gs.player.x, gs.player.y);
}

/** Homestead-wide architectural style, stable per homestead. */
export const STYLES = ["timber", "stone", "thatch"] as const;
export function styleOf(gs: GameState): string {
  const h = gs.homestead;
  if (!h) return STYLES[0];
  if (!h.style) h.style = STYLES[Math.abs(hashString(h.id)) % STYLES.length];
  return h.style;
}

/* ------------------------------- designations ------------------------------- */

export interface DesignationDef {
  id: RoomFacility;
  name: string;
  glyph: string;
  blurb: string;
  /** Minimum room interior size. */
  minW: number;
  minH: number;
  /** The permanent, one-time unlock price. */
  cost: FacilityCost;
  /** Functional furniture kinds, in priority order. */
  furniture: string[];
  /** Decorative kinds (never unlock gameplay). */
  decorations: string[];
}

export const DESIGNATIONS: Record<RoomFacility, DesignationDef> = {
  housing: {
    id: "housing",
    name: "Monster Housing",
    glyph: "⌂",
    blurb: "Troughs and pens — swap party monsters without trekking to town.",
    minW: 4,
    minH: 4,
    cost: c(60, { ore: 4 }),
    furniture: ["trough", "hayrack", "pen gate"],
    decorations: ["rug", "lamp", "potted fern"],
  },
  breeding: {
    id: "breeding",
    name: "Breeding Den",
    glyph: "♥",
    blurb: "A quiet den — pair monsters into nests here.",
    minW: 5,
    minH: 4,
    cost: c(80, { ore: 5, honeycomb: 2 }),
    furniture: ["nesting box", "perch", "warm stone"],
    decorations: ["dried grass", "lantern"],
  },
  nursery: {
    id: "nursery",
    name: "Nursery",
    glyph: "◍",
    blurb: "Warm incubators — tend and retrieve eggs from home.",
    minW: 3,
    minH: 4,
    cost: c(80, { ore: 5, honeycomb: 2 }),
    furniture: ["incubator", "brooder", "feather crib"],
    decorations: ["mobile", "soft rug"],
  },
  kitchen: {
    id: "kitchen",
    name: "Kitchen",
    glyph: "◿",
    blurb: "A hearth and prep table — cook meals at home.",
    minW: 3,
    minH: 4,
    cost: c(50, { ore: 3 }),
    furniture: ["stove", "prep table", "basin"],
    decorations: ["herb rack", "shelf"],
  },
  workshop: {
    id: "workshop",
    name: "Workshop",
    glyph: "⚒",
    blurb: "Anvil and bench — craft gear at home.",
    minW: 3,
    minH: 4,
    cost: c(60, { ore: 4 }),
    furniture: ["workbench", "anvil", "grindstone"],
    decorations: ["toolbox", "pegboard"],
  },
  storage: {
    id: "storage",
    name: "Store Room",
    glyph: "▣",
    blurb: "Shelves and crates — reach the homestead cellar from here.",
    minW: 2,
    minH: 3,
    cost: c(40, { ore: 2 }),
    furniture: ["shelf", "crate", "barrel"],
    decorations: ["wall hooks", "sack pile"],
  },
  study: {
    id: "study",
    name: "Study",
    glyph: "✎",
    blurb: "A quiet desk. For now, a place to think.",
    minW: 3,
    minH: 3,
    cost: c(30, {}),
    furniture: ["desk", "bookcase"],
    decorations: ["globe", "reading lamp"],
  },
  bedroom: {
    id: "bedroom",
    name: "Bedroom",
    glyph: "≡",
    blurb: "Your own bed — sleep until dawn, free of the inn's coin.",
    minW: 3,
    minH: 3,
    cost: c(30, {}),
    furniture: ["bed", "wardrobe", "mirror"],
    decorations: ["rug", "candle stand"],
  },
};

export const DESIGNATION_ORDER: RoomFacility[] = [
  "housing",
  "storage",
  "kitchen",
  "workshop",
  "bedroom",
  "study",
  "breeding",
  "nursery",
];

export function designationName(d: RoomDesignation): string {
  return d === "undesignated" ? "undesignated" : DESIGNATIONS[d].name;
}

/* ---------------------------------- prefabs --------------------------------- */

export interface PrefabRoomDef {
  /** Interior rect in local (unrotated) coordinates, walls excluded. Rooms
   *  inside one prefab are separated by a full shared wall tile (Update C.2). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which wall the room's doorway sits in: an outer wall opens to the
   *  outside; a wall shared with a neighbouring room opens inside. */
  side: "n" | "e" | "s" | "w";
}

export interface BuildingPrefab {
  id: string;
  name: string;
  blurb: string;
  /** Bounding box (walls included) in local coordinates. */
  w: number;
  h: number;
  rooms: PrefabRoomDef[];
  cost: FacilityCost;
  buildTicks: number;
}

export const PREFABS: BuildingPrefab[] = [
  {
    id: "cottage",
    name: "Small Cottage",
    blurb: "A snug 7×6 cottage with one 5×4 room.",
    w: 7,
    h: 6,
    rooms: [{ x: 1, y: 1, w: 5, h: 4, side: "s" }],
    cost: c(80, { ore: 6 }),
    buildTicks: 72,
  },
  {
    id: "lodge",
    name: "Timber Lodge",
    blurb: "A grand 11×8 lodge — two true rooms joined by an inner door.",
    w: 11,
    h: 8,
    rooms: [
      { x: 1, y: 1, w: 4, h: 6, side: "s" }, // outer wall, to the open air
      { x: 6, y: 1, w: 4, h: 6, side: "w" }, // shared wall x=5, into the first room
    ],
    cost: c(150, { ore: 12, honeycomb: 2 }),
    buildTicks: 96,
  },
  {
    id: "barn",
    name: "Field Barn",
    blurb: "A huge 11×9 barn — one open 9×7 space.",
    w: 11,
    h: 9,
    rooms: [{ x: 1, y: 1, w: 9, h: 7, side: "s" }],
    cost: c(130, { ore: 14 }),
    buildTicks: 96,
  },
  {
    id: "workshop-hall",
    name: "Workshop Building",
    blurb: "A 9×7 hall — a work room and a store, divided by a wall.",
    w: 9,
    h: 7,
    rooms: [
      { x: 1, y: 1, w: 3, h: 5, side: "s" },
      { x: 5, y: 1, w: 3, h: 5, side: "w" }, // shared wall x=4
    ],
    cost: c(120, { ore: 10 }),
    buildTicks: 96,
  },
];

export function prefabOf(id: string): BuildingPrefab | undefined {
  return PREFABS.find((p) => p.id === id);
}

/** 90° clockwise point transform from local prefab coords to world offsets. */
function rotPoint(lx: number, ly: number, w0: number, h0: number, rot: 0 | 90): { x: number; y: number } {
  void w0;
  return rot === 0 ? { x: lx, y: ly } : { x: h0 - 1 - ly, y: lx };
}

function rotSide(side: PrefabRoomDef["side"], rot: 0 | 90): PrefabRoomDef["side"] {
  if (rot === 0) return side;
  const map = { s: "w", w: "n", n: "e", e: "s" } as const;
  return map[side];
}

/** The doorway tile for a room rect: centred on the chosen wall. */
export function doorForRect(r: Rect, side: PrefabRoomDef["side"]): Doorway {
  switch (side) {
    case "n":
      return { x: r.x + (r.w >> 1), y: r.y - 1 };
    case "s":
      return { x: r.x + (r.w >> 1), y: r.y + r.h };
    case "e":
      return { x: r.x + r.w, y: r.y + (r.h >> 1) };
    case "w":
      return { x: r.x - 1, y: r.y + (r.h >> 1) };
  }
}

/** World-space room rects and doorways for a placed prefab. */
export function layoutOf(p: BuildingPrefab, x: number, y: number, rot: 0 | 90): { rect: Rect; doors: Doorway[] }[] {
  const lays = p.rooms.map((r) => {
    const a = rotPoint(r.x, r.y, p.w, p.h, rot);
    const b = rotPoint(r.x + r.w - 1, r.y + r.h - 1, p.w, p.h, rot);
    const rect: Rect = {
      x: x + Math.min(a.x, b.x),
      y: y + Math.min(a.y, b.y),
      w: rot === 0 ? r.w : r.h,
      h: rot === 0 ? r.h : r.w,
    };
    return { rect, doors: [doorForRect(rect, rotSide(r.side, rot))] };
  });
  // an interior doorway stands in a shared wall — it appears in both
  // neighbouring rooms' lists (Update C.2)
  for (const l of lays) {
    for (const d of l.doors) {
      for (const o of lays) {
        if (o === l || o.doors.some((dd) => dd.x === d.x && dd.y === d.y)) continue;
        if (!isOnRing(o.rect, d)) continue;
        const out = neighbourOutof(o.rect, d);
        if (rectContains(l.rect, out.x, out.y)) o.doors.push({ ...d });
      }
    }
  }
  return lays;
}

/* ------------------------------- construction ------------------------------- */

export function roomCostOf(w: number, h: number): FacilityCost {
  const area = w * h;
  const ore = Math.ceil(area / 5);
  return c(6 * area + 24, { ore });
}

export function roomTicksOf(w: number, h: number): number {
  return 24 + 2 * w * h;
}

function nextSeq(h: NonNullable<GameState["homestead"]>): string {
  h.buildSeq = (h.buildSeq ?? 0) + 1;
  return `b${h.buildSeq}`;
}

function newRoomId(h: NonNullable<GameState["homestead"]>): string {
  h.roomSeq = (h.roomSeq ?? 0) + 1;
  return `${h.id}-r${h.roomSeq}`;
}

function makeRoom(h: NonNullable<GameState["homestead"]>, buildingId: string, rect: Rect, doors: Doorway[], tick: number, completeTick: number, style: string): RoomRecord {
  return {
    id: newRoomId(h),
    buildingId,
    ...rect,
    doors: doors.map((d) => ({ ...d })),
    designation: "undesignated",
    complete: false,
    completeTick,
    style,
    furniture: [],
  };
}

/**
 * Why this tile cannot take a floor or wall of a building (Update C.2 —
 * water, settlement site pieces and roads are absolute; trees, shrubs and
 * rocks are natural resources that construction CLEARS, an explicit player
 * decision announced in the log — nothing is silently overwritten).
 * Returns "" when the tile is buildable.
 */
export function tileObstruction(gs: GameState, x: number, y: number): string {
  const world = getWorld(gs.seed);
  if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return "There is no land there.";
  const t = world.tile(x, y);
  if (!BIOMES[t.biome].passable) return "The ground there will not take a building — clear, dry ground only.";
  if (world.siteAt(x, y)) return "That ground is already spoken for.";
  if (roadAt(world, x, y)) return "An old road crosses there — the way must stay open.";
  return "";
}

/** The first blocking tile's reason across a rect, or "" if every tile is buildable. */
function tilesReason(gs: GameState, r: Rect, opts: { ignoreObjects?: boolean } = {}): string {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (opts.ignoreObjects) {
        const world = getWorld(gs.seed);
        if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return "There is no land there.";
        const t = world.tile(x, y);
        if (!BIOMES[t.biome].passable) return "The ground there will not take a building — clear, dry ground only.";
        if (world.siteAt(x, y)) return "That ground is already spoken for.";
        continue;
      }
      const reason = tileObstruction(gs, x, y);
      if (reason) return reason;
    }
  }
  return "";
}

function tilesFree(gs: GameState, r: Rect, opts: { ignoreObjects?: boolean } = {}): boolean {
  return tilesReason(gs, r, opts) === "";
}

function bboxConflicts(gs: GameState, bbox: Rect, selfId?: string): string {
  const h = gs.homestead!;
  const prop = propertyRectOf(gs)!;
  if (!rectContains(prop, bbox.x, bbox.y) || !rectContains(prop, bbox.x + bbox.w - 1, bbox.y + bbox.h - 1)) {
    return "That would stand outside your property bounds.";
  }
  for (const b of h.buildings ?? []) {
    if (b.id === selfId) continue;
    if (rectsOverlap(grow(bbox, 1), b)) {
      return `Too close to the ${prefabOf(b.prefabId)?.name ?? "other building"} — leave room to walk between.`;
    }
  }
  return "";
}

/** Returns a spoken reason, or "" if a prefab could be placed with its top-left corner at (x, y). */
export function canPlaceBuilding(gs: GameState, prefabId: string, x: number, y: number, rot: 0 | 90 = 0): string {
  const h = gs.homestead;
  if (!h) return "You own no homestead yet.";
  const p = prefabOf(prefabId);
  if (!p) return "There is no such plan.";
  const w = rot === 0 ? p.w : p.h;
  const hh = rot === 0 ? p.h : p.w;
  const bbox = { x, y, w, h: hh };
  const conflict = bboxConflicts(gs, bbox);
  if (conflict) return conflict;
  return tilesReason(gs, bbox);
}

/**
 * Places a prefab building (atomic: nothing changes unless affordable and valid).
 * Returns "" on success or a spoken refusal.
 */
export function placeBuilding(gs: GameState, prefabId: string, x: number, y: number, rot: 0 | 90 = 0): string {
  const h = gs.homestead;
  if (!h) return "You own no homestead yet.";
  const p = prefabOf(prefabId);
  if (!p) return "There is no such plan.";
  const reason = canPlaceBuilding(gs, prefabId, x, y, rot);
  if (reason) return reason;
  if (!canAfford(gs, p.cost)) {
    return `You lack the means — the ${p.name.toLowerCase()} wants ${costLabel(p.cost).toLowerCase()}.`;
  }
  payCost(gs, p.cost);
  const style = styleOf(gs);
  const id = nextSeq(h);
  const w = rot === 0 ? p.w : p.h;
  const hh = rot === 0 ? p.h : p.w;
  const completeTick = gs.tick + p.buildTicks;
  h.buildings = h.buildings ?? [];
  h.buildings.push({
    id,
    prefabId,
    x,
    y,
    w,
    h: hh,
    rot,
    style,
    complete: false,
    completeTick,
  });
  h.rooms = h.rooms ?? [];
  for (const lay of layoutOf(p, x, y, rot)) {
    h.rooms.push(makeRoom(h, id, lay.rect, lay.doors, gs.tick, completeTick, style));
  }
  return "";
}

/* ------------------------------ room expansion ------------------------------ */

export type Side = "n" | "e" | "s" | "w";

/** What to attach to a building: a full room, or a narrow passage (Update C.2). */
export type ExpansionKind = "room" | "corridor";

export interface ExpansionPlan {
  kind: ExpansionKind;
  room: Rect;
  /** The doorway(s) the new room would open: into the parent building, and
   *  for a corridor also out at the far end. */
  doors: Doorway[];
  bbox: Rect;
  cost: FacilityCost;
  ticks: number;
}

/** Pure preview of what attaching a room or corridor on the given side would build. */
export function expansionPlan(building: BuildingRecord, side: Side, kind: ExpansionKind = "room"): ExpansionPlan | null {
  const depth = kind === "corridor" ? 3 : 3;
  const rw = kind === "corridor" ? 1 : side === "n" || side === "s" ? Math.min(5, Math.max(3, building.w - 2)) : depth;
  const rh = kind === "corridor" ? 1 : side === "e" || side === "w" ? Math.min(5, Math.max(3, building.h - 2)) : depth;
  let room: Rect;
  switch (side) {
    case "n":
      room = { x: building.x + 1 + Math.floor((building.w - 2 - rw) / 2), y: building.y - depth, w: rw, h: rh };
      break;
    case "s":
      room = { x: building.x + 1 + Math.floor((building.w - 2 - rw) / 2), y: building.y + building.h, w: rw, h: rh };
      break;
    case "e":
      room = { x: building.x + building.w, y: building.y + 1 + Math.floor((building.h - 2 - rh) / 2), w: rw, h: rh };
      break;
    case "w":
      room = { x: building.x - depth, y: building.y + 1 + Math.floor((building.h - 2 - rh) / 2), w: rw, h: rh };
      break;
  }
  const bbox = { x: Math.min(building.x, room.x), y: Math.min(building.y, room.y), w: 0, h: 0 };
  bbox.w = Math.max(building.x + building.w, room.x + room.w) - bbox.x;
  bbox.h = Math.max(building.y + building.h, room.y + room.h) - bbox.y;
  // the doorway into the parent building: centred on the shared wall segment
  const inward: PrefabRoomDef["side"] = side === "n" ? "s" : side === "s" ? "n" : side === "e" ? "w" : "e";
  const doors: Doorway[] = [doorForRect(room, inward)];
  // a corridor also opens at its far end, so it can stand as a passage way out
  if (kind === "corridor") doors.push(doorForRect(room, side));
  return { kind, room, doors, bbox, cost: roomCostOf(room.w, room.h), ticks: roomTicksOf(room.w, room.h) };
}

/**
 * Valid doorway positions for a planned room addition: shared-wall tiles whose
 * far side opens into a complete room of the parent building. The player may
 * choose among these; the centred default comes first.
 */
export function doorCandidates(gs: GameState, buildingId: string, plan: ExpansionPlan): Doorway[] {
  const h = gs.homestead;
  if (!h) return [];
  const b = (h.buildings ?? []).find((x) => x.id === buildingId);
  if (!b) return [];
  const out: Doorway[] = [];
  if (plan.doors[0]) out.push({ ...plan.doors[0] });
  for (const t of sharedWallTiles(b, plan)) {
    const inward = neighbourInto(plan.room, t);
    if (!inward) continue;
    const inside = roomAt(gs, inward.x, inward.y);
    if (inside && inside.buildingId === b.id && inside.complete && !out.some((o) => o.x === t.x && o.y === t.y)) {
      out.push({ ...t });
    }
  }
  return out;
}

/** Shared wall tiles between a building and a planned adjacent room: the planned room's
 *  inward wall ring that lies inside the building's bounding box. */
function sharedWallTiles(b: BuildingRecord, plan: ExpansionPlan): { x: number; y: number }[] {
  const r = plan.room;
  const out: { x: number; y: number }[] = [];
  // which side of the planned room touches the building
  const touchesN = r.y - 1 >= b.y && r.y - 1 < b.y + b.h;
  const touchesS = r.y + r.h >= b.y && r.y + r.h < b.y + b.h;
  const touchesW = r.x - 1 >= b.x && r.x - 1 < b.x + b.w;
  const touchesE = r.x + r.w >= b.x && r.x + r.w < b.x + b.w;
  const push = (x: number, y: number): void => {
    out.push({ x, y });
  };
  if (touchesN) for (let x = r.x; x < r.x + r.w; x++) push(x, r.y - 1);
  if (touchesS) for (let x = r.x; x < r.x + r.w; x++) push(x, r.y + r.h);
  if (touchesW) for (let y = r.y; y < r.y + r.h; y++) push(r.x - 1, y);
  if (touchesE) for (let y = r.y; y < r.y + r.h; y++) push(r.x + r.w, y);
  return out;
}

/**
 * Full pre-construction validation for an expansion: geometry, ground, world
 * objects, doorway validity and room connectivity, affordability. Returns a
 * spoken reason, or "" when the build may go ahead.
 */
export function validateExpansion(gs: GameState, buildingId: string, side: Side, kind: ExpansionKind = "room", door?: Doorway): string {
  const h = gs.homestead;
  if (!h) return "You own no homestead yet.";
  const b = (h.buildings ?? []).find((x) => x.id === buildingId);
  if (!b) return "No such building stands on your land.";
  if (!b.complete) return "Finish the building before extending it.";
  const plan = expansionPlan(b, side, kind);
  if (!plan) return "That side will not take another room.";
  const conflict = bboxConflicts(gs, plan.bbox, b.id);
  if (conflict) return conflict;
  const ground = tilesReason(gs, grow(plan.room, 1));
  if (ground) return ground;
  // the doorway into the parent building (default: centred) must open into a
  // complete room — that is what keeps every room reachable
  const chosen = door ?? plan.doors[0];
  if (plan.doors[0] && isOnRing(plan.room, plan.doors[0])) {
    const parentTile = neighbourOutof(plan.room, plan.doors[0]);
    const inside = roomAt(gs, parentTile.x, parentTile.y);
    if (!inside || inside.buildingId !== b.id || !inside.complete) {
      return "The doorway must open into a finished room of the building.";
    }
  }
  if (kind === "room" && door) {
    if (!isOnRing(plan.room, door)) return "The doorway does not sit on the room's wall.";
    const parentTile = neighbourOutof(plan.room, door);
    const inside = roomAt(gs, parentTile.x, parentTile.y);
    if (!inside || inside.buildingId !== b.id || !inside.complete) {
      return "The doorway must open into a finished room of the building.";
    }
  }
  if (kind === "corridor" && plan.doors[1]) {
    // the far end must let a walker out onto open ground
    const outTile = neighbourOutof(plan.room, plan.doors[1]);
    const ob = tileObstruction(gs, outTile.x, outTile.y);
    if (ob) return ob;
  }
  if (!canAfford(gs, plan.cost)) {
    return `You lack the means — the ${kind === "corridor" ? "passage" : "room"} wants ${costLabel(plan.cost).toLowerCase()}.`;
  }
  return "";
}

function isOnRing(room: Rect, d: Doorway): boolean {
  return (
    d.y === room.y - 1 ||
    d.y === room.y + room.h ||
    d.x === room.x - 1 ||
    d.x === room.x + room.w
  ) && d.x >= room.x - 1 && d.x <= room.x + room.w && d.y >= room.y - 1 && d.y <= room.y + room.h;
}

function neighbourInto(room: Rect, d: Doorway): { x: number; y: number } | null {
  if (d.y === room.y - 1) return { x: d.x, y: room.y };
  if (d.y === room.y + room.h) return { x: d.x, y: room.y + room.h - 1 };
  if (d.x === room.x - 1) return { x: room.x, y: d.y };
  if (d.x === room.x + room.w) return { x: room.x + room.w - 1, y: d.y };
  return null;
}

function neighbourOutof(room: Rect, d: Doorway): { x: number; y: number } {
  if (d.y === room.y - 1) return { x: d.x, y: room.y - 2 };
  if (d.y === room.y + room.h) return { x: d.x, y: room.y + room.h + 1 };
  if (d.x === room.x - 1) return { x: room.x - 2, y: d.y };
  return { x: room.x + room.w + 1, y: d.y };
}

/**
 * Attaches a room or corridor to a complete building (atomic: nothing changes
 * unless valid and affordable). The building keeps its identity; its bounds
 * grow to enclose the new room. Returns "" on success.
 */
export function addRoomToBuilding(gs: GameState, buildingId: string, side: Side, kind: ExpansionKind = "room", door?: Doorway): string {
  const h = gs.homestead;
  if (!h) return "You own no homestead yet.";
  const err = validateExpansion(gs, buildingId, side, kind, door);
  if (err) return err;
  const b = (h.buildings ?? []).find((x) => x.id === buildingId)!;
  const plan = expansionPlan(b, side, kind)!;
  payCost(gs, plan.cost);
  b.x = plan.bbox.x;
  b.y = plan.bbox.y;
  b.w = plan.bbox.w;
  b.h = plan.bbox.h;
  const style = styleOf(gs);
  const doors = kind === "room" && door ? [door] : plan.doors;
  const room = makeRoom(h, b.id, plan.room, doors, gs.tick, gs.tick + plan.ticks, style);
  h.rooms = h.rooms ?? [];
  h.rooms.push(room);
  // an interior doorway appears in both neighbouring rooms' lists
  if (kind === "room") {
    const outward = neighbourOutof(plan.room, doors[0]);
    const parent = roomAt(gs, outward.x, outward.y);
    if (parent && parent.id !== room.id) parent.doors = [...parent.doors, { ...doors[0] }];
  }
  return "";
}

/* ------------------------- room widening (expansion) ------------------------- */

export interface GrowPlan {
  grown: Rect;
  cost: FacilityCost;
  ticks: number;
}

/** Pure preview of widening a room by one tile on the given side. */
export function growRoomPlan(room: RoomRecord, side: Side): GrowPlan {
  const grown: Rect = { ...room };
  if (side === "n") {
    grown.y -= 1;
    grown.h += 1;
  } else if (side === "s") grown.h += 1;
  else if (side === "w") {
    grown.x -= 1;
    grown.w += 1;
  } else grown.w += 1;
  const oldCost = roomCostOf(room.w, room.h);
  const newCost = roomCostOf(grown.w, grown.h);
  return {
    grown,
    cost: c(newCost.gold - oldCost.gold, { ore: (newCost.items.ore ?? 0) - (oldCost.items.ore ?? 0) }),
    ticks: roomTicksOf(grown.w, grown.h) - roomTicksOf(room.w, room.h),
  };
}

/**
 * Widens a complete room by one tile on one side, into that side's outer wall
 * and the ground beyond. A wall with a doorway in it cannot be consumed — use
 * another side. Furniture is refitted to the new proportions. Returns "".
 */
export function expandRoom(gs: GameState, roomId: string, side: Side): string {
  const h = gs.homestead;
  if (!h) return "You own no homestead yet.";
  const room = (h.rooms ?? []).find((r) => r.id === roomId);
  if (!room) return "No such room.";
  if (!room.complete) return "Finish the room before widening it.";
  if (room.doors.some((d) => doorSideOf(room, d) === side)) {
    return "A doorway stands in that wall — widen another side.";
  }
  const plan = growRoomPlan(room, side);
  if (!canAfford(gs, plan.cost)) {
    return `You lack the means — the widening wants ${costLabel(plan.cost).toLowerCase()}.`;
  }
  // the new outer wall ring must stand on buildable ground inside the property
  const b = (h.buildings ?? []).find((x) => x.id === room.buildingId);
  if (!b) return "No such building stands on your land.";
  const outer = outerRing(plan.grown);
  for (const t of outer) {
    if (otherRoomAt(h, t.x, t.y, room.id)) {
      return "Another room stands in the way.";
    }
    const ob = tileObstruction(gs, t.x, t.y);
    if (ob) return ob;
  }
  const prop = propertyRectOf(gs)!;
  if (!rectContains(prop, plan.grown.x, plan.grown.y) || !rectContains(prop, plan.grown.x + plan.grown.w - 1, plan.grown.y + plan.grown.h - 1)) {
    return "That would stand outside your property bounds.";
  }
  payCost(gs, plan.cost);
  room.x = plan.grown.x;
  room.y = plan.grown.y;
  room.w = plan.grown.w;
  room.h = plan.grown.h;
  // doors keep their wall positions (none were on the grown side)
  room.furniture = room.designation === "undesignated" ? [] : generateFurniture(room);
  growBbox(h, b);
  return "";
}

/** True when the room has a doorway in the given side's wall. */
export function sideHasDoor(room: RoomRecord, side: Side): boolean {
  return room.doors.some((d) => doorSideOf(room, d) === side);
}

function doorSideOf(room: RoomRecord, d: Doorway): Side {
  if (d.y === room.y - 1) return "n";
  if (d.y === room.y + room.h) return "s";
  if (d.x === room.x - 1) return "w";
  return "e";
}

function outerRing(r: Rect): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let x = r.x - 1; x <= r.x + r.w; x++) {
    out.push({ x, y: r.y - 1 });
    out.push({ x, y: r.y + r.h });
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    out.push({ x: r.x - 1, y });
    out.push({ x: r.x + r.w, y });
  }
  return out;
}

function otherRoomAt(h: NonNullable<GameState["homestead"]>, x: number, y: number, exceptId: string): boolean {
  return (h.rooms ?? []).some((r) => r.id !== exceptId && rectContains(r, x, y));
}

/** Recomputes a building's bounding box from its rooms' wall rings. */
export function growBbox(h: NonNullable<GameState["homestead"]>, b: BuildingRecord): void {
  const rooms = (h.rooms ?? []).filter((r) => r.buildingId === b.id);
  if (rooms.length === 0) return;
  const u = unionOf(rooms.map((r) => grow(r, 1)));
  b.x = u.x;
  b.y = u.y;
  b.w = u.w;
  b.h = u.h;
}

/* --------------------------------- settling --------------------------------- */

/** Promotes finished buildings and rooms; (re)generates furniture on completion. Idempotent. */
export function settleBuildings(gs: GameState): void {
  const h = gs.homestead;
  if (!h) return;
  for (const b of h.buildings ?? []) {
    if (!b.complete && gs.tick >= (b.completeTick ?? Infinity)) b.complete = true;
  }
  for (const r of h.rooms ?? []) {
    if (!r.complete && gs.tick >= (r.completeTick ?? Infinity)) {
      r.complete = true;
      r.furniture = generateFurniture(r);
    }
  }
}

/* --------------------------------- furniture -------------------------------- */

/* --------------------------------- furniture -------------------------------- */

/** Footprints of multi-tile furniture, oriented along the wall it stands on. */
const FOOTPRINTS: Record<string, [number, number]> = {
  bed: [2, 1],
  "prep table": [2, 1],
  workbench: [2, 1],
  "nesting box": [1, 2],
};

function footprintOf(kind: string, vertical: boolean): [number, number] {
  const fp = FOOTPRINTS[kind] ?? [1, 1];
  return vertical ? [fp[1], fp[0]] : fp;
}

/** The interior tiles just inside each doorway — the entrance tiles that must stay clear. */
export function doorInsideTiles(room: RoomRecord): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const d of room.doors) {
    if (d.y === room.y - 1) out.push({ x: d.x, y: room.y });
    else if (d.y === room.y + room.h) out.push({ x: d.x, y: room.y + room.h - 1 });
    else if (d.x === room.x - 1) out.push({ x: room.x, y: d.y });
    else if (d.x === room.x + room.w) out.push({ x: room.x + room.w - 1, y: d.y });
  }
  return out;
}

/** Would the given blocked set still leave every entrance tile of the room connected? */
function entrancesConnected(room: RoomRecord, blocked: Set<number>): boolean {
  const insides = doorInsideTiles(room);
  if (insides.length === 0) return true;
  const start = insides.find((t) => !blocked.has(t.y * WORLD_SIZE + t.x));
  if (!start) return false;
  const seen = new Set<number>([start.y * WORLD_SIZE + start.x]);
  const q = [start];
  while (q.length) {
    const t = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = t.x + dx;
      const ny = t.y + dy;
      if (nx < room.x || ny < room.y || nx >= room.x + room.w || ny >= room.y + room.h) continue;
      const k = ny * WORLD_SIZE + nx;
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      q.push({ x: nx, y: ny });
    }
  }
  return insides.every((t) => seen.has(t.y * WORLD_SIZE + t.x));
}

/**
 * Auto-generates furniture from designation + dimensions + style (Update C.2
 * rules): functional pieces first along the walls, decorations only if space
 * remains. Pieces fit inside the room, never on a doorway or entrance tile,
 * and are placed tentatively — any piece that would wall off an entrance is
 * skipped, so no layout can trap the player. Decorative pieces never unlock
 * gameplay. Deterministic per room id.
 */
export function generateFurniture(room: RoomRecord): FurnitureItem[] {
  const out: FurnitureItem[] = [];
  if (room.designation === "undesignated") return out;
  const def = DESIGNATIONS[room.designation];
  const area = room.w * room.h;
  const seed = Math.abs(hashString(room.id));
  // interior tiles next to an outer wall, excluding every entrance tile
  const entrances = new Set(doorInsideTiles(room).map((t) => t.y * WORLD_SIZE + t.x));
  const verticalWall = (x: number): boolean => x === room.x || x === room.x + room.w - 1;
  const wallTiles: { x: number; y: number; vertical: boolean }[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (!entrances.has(y * WORLD_SIZE + x) && (verticalWall(x) || y === room.y || y === room.y + room.h - 1)) {
        wallTiles.push({ x, y, vertical: verticalWall(x) });
      }
    }
  }
  wallTiles.sort((a, b) => hash01(seed, a.x * 31 + a.y, 7) - hash01(seed, b.x * 31 + b.y, 7));
  const blocked = new Set<number>(); // furniture tiles only; entrances are guarded separately
  const fits = (x: number, y: number, fw: number, fh: number): boolean => {
    if (x < room.x || y < room.y || x + fw > room.x + room.w || y + fh > room.y + room.h) return false;
    for (let yy = y; yy < y + fh; yy++) {
      for (let xx = x; xx < x + fw; xx++) {
        const k = yy * WORLD_SIZE + xx;
        if (blocked.has(k) || entrances.has(k)) return false;
      }
    }
    return true;
  };
  const place = (kind: string, decorative: boolean, vertical: boolean): boolean => {
    const [fw, fh] = footprintOf(kind, vertical);
    for (const t of wallTiles) {
      // anchor the piece against the wall it was drawn from
      const x = vertical ? Math.min(t.x, room.x + room.w - fw) : t.x;
      const y = vertical ? t.y : Math.min(t.y, room.y + room.h - fh);
      if (!fits(x, y, fw, fh)) continue;
      const keys: number[] = [];
      for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) keys.push(yy * WORLD_SIZE + xx);
      for (const k of keys) blocked.add(k);
      if (entrancesConnected(room, blocked)) {
        out.push({ kind, x, y, w: fw > 1 ? fw : undefined, h: fh > 1 ? fh : undefined, decorative });
        return true;
      }
      for (const k of keys) blocked.delete(k);
    }
    return false;
  };
  const fnCount = Math.min(def.furniture.length, Math.max(1, Math.floor(area / 8)));
  for (let i = 0; i < fnCount; i++) {
    if (place(def.furniture[i], false, false) || place(def.furniture[i], false, true)) continue;
  }
  const freeTiles: { x: number; y: number }[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const k = y * WORLD_SIZE + x;
      if (!blocked.has(k) && !entrances.has(k)) freeTiles.push({ x, y });
    }
  }
  freeTiles.sort((a, b) => hash01(seed + 1, a.x * 31 + a.y, 11) - hash01(seed + 1, b.x * 31 + b.y, 11));
  const decoCount = Math.min(def.decorations.length, freeTiles.length, Math.floor(area / 12));
  for (let i = 0; i < decoCount; i++) {
    place(def.decorations[i], true, false);
  }
  return out;
}

/* ------------------------------ sets & assignment ----------------------------- */

export function setOwned(gs: GameState, f: RoomFacility): boolean {
  return gs.homestead?.designations?.[f] === 1;
}

/** Buys a designation set — a permanent, homestead-wide unlock. Returns "" on success. */
export function buyDesignationSet(gs: GameState, f: RoomFacility): string {
  const h = gs.homestead;
  if (!h) return "You own no homestead yet.";
  const def = DESIGNATIONS[f];
  if (!def) return "There is no such designation.";
  h.designations = h.designations ?? {};
  if (h.designations[f]) return `You already hold the ${def.name} set.`;
  if (!canAfford(gs, def.cost)) {
    return `You lack the means — the ${def.name} set wants ${costLabel(def.cost).toLowerCase()}.`;
  }
  payCost(gs, def.cost);
  h.designations[f] = 1;
  return "";
}

/** Data-driven suitability: can this room serve this designation? Returns "" if yes. */
export function suitability(room: RoomRecord, f: RoomFacility): string {
  const def = DESIGNATIONS[f];
  if (room.w < def.minW || room.h < def.minH) {
    return `A ${def.name} needs at least ${def.minW}×${def.minH} paces — this room is ${room.w}×${room.h}.`;
  }
  return "";
}

/**
 * Assigns (or clears) a room's designation. The designation set must already
 * be owned (a permanent unlock). Conversion is always safe: storage is
 * homestead-wide, so no items, eggs or monsters live *in* a room to destroy.
 * Returns "" on success.
 */
export function assignDesignation(gs: GameState, roomId: string, f: RoomDesignation): string {
  const h = gs.homestead;
  if (!h) return "You own no homestead yet.";
  const room = (h.rooms ?? []).find((r) => r.id === roomId);
  if (!room) return "No such room.";
  if (!onProperty(gs)) return "Stand on your homestead to rework your rooms.";
  if (f !== "undesignated") {
    const def = DESIGNATIONS[f];
    if (!setOwned(gs, f)) return `You do not hold the ${def.name} designation set yet — buy it once and it is yours forever.`;
    const s = suitability(room, f);
    if (s) return s;
  }
  room.designation = f;
  room.furniture = f === "undesignated" ? [] : generateFurniture(room);
  return "";
}

/* ------------------------------- access & lookup ------------------------------ */

/** The room whose interior contains the tile, if any. */
export function roomAt(gs: GameState, x: number, y: number): RoomRecord | undefined {
  return (gs.homestead?.rooms ?? []).find((r) => rectContains(r, x, y));
}

export type StructureKind = "wall" | "door" | "floor";

/**
 * What the homestead puts on this world tile (null = ordinary ground).
 * Incomplete buildings are solid scaffolding; complete buildings have true
 * rooms — wall perimeters, interior walls between rooms, doorways and open
 * floors (Update C.2).
 */
export function structureAt(gs: GameState, x: number, y: number): StructureKind | null {
  const h = gs.homestead;
  if (!h) return null;
  for (const b of h.buildings ?? []) {
    if (!rectContains(b, x, y)) continue;
    if (!b.complete) return "wall"; // scaffolding
    const room = (h.rooms ?? []).find((r) => r.buildingId === b.id && rectContains(r, x, y));
    if (room) return room.complete ? "floor" : "wall";
    for (const r of h.rooms ?? []) {
      if (r.buildingId === b.id && r.complete && r.doors.some((d) => d.x === x && d.y === y)) return "door";
    }
    return "wall";
  }
  return null;
}

/** The piece of furniture covering this tile, if any (Update C.2 footprints). */
export function furnitureAt(gs: GameState, x: number, y: number): { item: FurnitureItem; room: RoomRecord } | null {
  for (const r of gs.homestead?.rooms ?? []) {
    if (!r.complete) continue;
    for (const f of r.furniture) {
      const fw = f.w ?? 1;
      const fh = f.h ?? 1;
      if (x >= f.x && x < f.x + fw && y >= f.y && y < f.y + fh) return { item: f, room: r };
    }
  }
  return null;
}

/** Movement hook: true when the homestead's walls or furniture block this tile. */
export function homesteadBlocks(gs: GameState, x: number, y: number): boolean {
  if (structureAt(gs, x, y) === "wall") return true;
  return furnitureAt(gs, x, y) !== null;
}

/**
 * The physical-access rule (Phase 6): a room function may only be used while
 * standing inside a complete room designated for it, in a set you own.
 * Returns "" when access is granted, else a spoken reason.
 */
export function roomAccessReason(gs: GameState, f: RoomFacility): string {
  const h = gs.homestead;
  if (!h) return "You own no homestead yet.";
  const def = DESIGNATIONS[f];
  if (!propertyRectOf(gs) || !onProperty(gs)) {
    return `The ${def.name.toLowerCase()} is part of your homestead — travel there and step inside.`;
  }
  const room = roomAt(gs, gs.player.x, gs.player.y);
  if (!room) {
    return `Step inside your ${def.name.toLowerCase()} to do that.`;
  }
  if (!room.complete) return "This room is still being raised.";
  if (room.designation !== f) {
    return `This room is ${room.designation === "undesignated" ? "undesignated" : `a ${designationName(room.designation).toLowerCase()}`} — stand inside your ${def.name.toLowerCase()} instead.`;
  }
  if (!setOwned(gs, f)) return `You do not hold the ${def.name} designation set.`;
  return "";
}

/** One lookup for the map renderer: everything the homestead draws, by tile key. */
export interface HomesteadTile {
  t: StructureKind;
  room?: RoomRecord;
  furniture?: FurnitureItem;
  building?: BuildingRecord;
}

export function homesteadTileMap(gs: GameState): Map<number, HomesteadTile> {
  const map = new Map<number, HomesteadTile>();
  const h = gs.homestead;
  if (!h) return map;
  const key = (x: number, y: number) => y * WORLD_SIZE + x;
  for (const b of h.buildings ?? []) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        map.set(key(x, y), { t: b.complete ? "wall" : "wall", building: b });
      }
    }
  }
  for (const r of h.rooms ?? []) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        map.set(key(x, y), { t: r.complete ? "floor" : "wall", room: r });
      }
    }
  }
  for (const r of h.rooms ?? []) {
    if (!r.complete) continue;
    for (const d of r.doors) map.set(key(d.x, d.y), { t: "door", room: r });
  }
  for (const r of h.rooms ?? []) {
    if (!r.complete) continue;
    for (const f of r.furniture) {
      const fw = f.w ?? 1;
      const fh = f.h ?? 1;
      for (let yy = f.y; yy < f.y + fh; yy++) {
        for (let xx = f.x; xx < f.x + fw; xx++) {
          map.set(key(xx, yy), { t: "floor", room: r, furniture: f });
        }
      }
    }
  }
  return map;
}

/**
 * Finds a clear rectangle inside the property for a free compatibility
 * building: strict first (nothing covered), then relaxed over world objects
 * as a last resort so every homestead still gets its cottage.
 */
function findFirstClearSpot(gs: GameState, prop: Rect, w: number, h: number): { x: number; y: number } | null {
  for (const ignoreObjects of [false, true]) {
    for (let oy = 0; oy + h + 4 <= prop.h; oy++) {
      for (let ox = 0; ox + w + 4 <= prop.w; ox++) {
        const cand = { x: prop.x + 2 + ox, y: prop.y + 2 + oy, w, h };
        if (tilesFree(gs, cand, { ignoreObjects })) return { x: cand.x, y: cand.y };
      }
    }
  }
  return null;
}

function buildInstantFromPrefab(gs: GameState, p: BuildingPrefab, x: number, y: number, rot: 0 | 90, atTick: number): void {
  const h = gs.homestead!;
  const style = styleOf(gs);
  const id = nextSeq(h);
  const w = rot === 0 ? p.w : p.h;
  const hh = rot === 0 ? p.h : p.w;
  h.buildings!.push({ id, prefabId: p.id, x, y, w, h: hh, rot, style, complete: true, completeTick: atTick });
  for (const lay of layoutOf(p, x, y, rot)) {
    const room = makeRoom(h, id, lay.rect, lay.doors, atTick, atTick, style);
    room.complete = true;
    h.rooms!.push(room);
  }
}

/**
 * Grants a newly bought homestead its starter cottage: free, already built,
 * one undesignated room — a home to grow from.
 */
export function grantStarterCottage(gs: GameState): void {
  const h = gs.homestead;
  if (!h || (h.buildings?.length ?? 0) > 0 || (h.rooms?.length ?? 0) > 0) return;
  h.buildings ??= [];
  h.rooms ??= [];
  const prop = propertyRectOf(gs);
  if (!prop) return;
  const p = prefabOf("cottage");
  if (!p) return;
  const spot = findFirstClearSpot(gs, prop, p.w, p.h);
  if (!spot) return;
  buildInstantFromPrefab(gs, p, spot.x, spot.y, 0, h.boughtTick);
}

/* --------------------------------- migration --------------------------------- */

/**
 * Backfills Update C.1/C.2 fields and gives pre-C.1 homesteads a compatibility
 * path: a free, already-built cottage whose rooms are designated to match the
 * facilities the player already owns (with the matching sets granted free).
 * C.2: every room gains its doorway list (from the single legacy door); a
 * complete room whose doorway no longer lets anyone in or out gets a repaired
 * exterior door on clear ground — no world object is ever deleted instead.
 * Facility levels stay authoritative for capacity. Idempotent and
 * non-destructive — nothing existing is deleted, disabled or lost.
 */
export function migrateBuildings(gs: GameState): void {
  const h = gs.homestead;
  if (!h) return;
  h.property = propertyRectOf(gs) ?? undefined;
  h.buildings ??= [];
  h.rooms ??= [];
  h.designations = h.designations ?? {};
  h.roomSeq ??= h.rooms.length;
  h.buildSeq ??= h.buildings.length;
  styleOf(gs);
  if (h.buildings.length > 0) {
    // repair torn rooms/furniture and the v29 doorway topology, nothing more
    for (const r of h.rooms) {
      r.designation = r.designation ?? "undesignated";
      r.style = r.style ?? h.style!;
      if (!r.doors || r.doors.length === 0) {
        const legacy = (r as { door?: { x: number; y: number } }).door;
        r.doors = legacy ? [{ x: legacy.x, y: legacy.y }] : [doorForRect(r, "s")];
      }
      delete (r as { door?: unknown }).door;
      if (r.complete && r.furniture.length === 0 && r.designation !== "undesignated") {
        r.furniture = generateFurniture(r);
      }
    }
    repairDoors(gs);
    return;
  }
  // Compatibility: pre-C.1 save. Build the free Homesteader's Cottage with one
  // 5×4 room per owned access-gating facility, designated to match.
  const map: { facility: string; designation: RoomFacility }[] = [
    { facility: "pens", designation: "housing" },
    { facility: "storage", designation: "storage" },
    { facility: "breeding", designation: "breeding" },
    { facility: "nursery", designation: "nursery" },
  ];
  const owned = map.filter((m) => (h.facilities[m.facility]?.level ?? 0) > 0);
  const n = Math.max(1, owned.length);
  const cols = Math.min(2, n);
  const rows = Math.ceil(n / cols);
  const rw = 5;
  const rh = 4;
  // true walls between neighbouring rooms: a full shared tile between them
  const bw = 2 + cols * rw + (cols - 1);
  const bh = 2 + rows * rh + (rows - 1);
  const prop = h.property!;
  const spot = findFirstClearSpot(gs, prop, bw, bh);
  const px = spot ? spot.x : prop.x + 2;
  const py = spot ? spot.y : prop.y + 2;
  const style = styleOf(gs);
  const bid = nextSeq(h);
  const building: BuildingRecord = {
    id: bid,
    prefabId: "homesteaders-cottage",
    x: px,
    y: py,
    w: bw,
    h: bh,
    rot: 0,
    style,
    complete: true,
    completeTick: h.boughtTick,
  };
  h.buildings.push(building);
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rect: Rect = { x: px + 1 + col * (rw + 1), y: py + 1 + row * (rh + 1), w: rw, h: rh };
    // ground-floor rooms open to the open air; rooms behind them open into
    // the room in front through their shared wall
    const doors: Doorway[] = [];
    if (row === 0) doors.push(doorForRect(rect, "s"));
    else {
      const d = doorForRect(rect, "n");
      doors.push(d);
      const front = (h.rooms ?? []).find((r) => r.buildingId === bid && r.x === rect.x && r.y + r.h + 1 === rect.y);
      if (front) front.doors = [...front.doors, { ...d }];
    }
    const room = makeRoom(h, bid, rect, doors, h.boughtTick, h.boughtTick, style);
    room.complete = true;
    const m = owned[i];
    if (m) {
      room.designation = m.designation;
      h.designations[m.designation] = 1;
      room.furniture = generateFurniture(room);
    }
    h.rooms.push(room);
  }
}

/**
 * Safety net for older layouts: every complete room must have a doorway that
 * actually lets someone in or out (a shared interior doorway or an exterior
 * one onto passable ground). A room stranded by later construction or blocked
 * ground gets a repaired exterior door on the first clear wall — no world
 * object is removed and no room geometry changes.
 */
export function repairDoors(gs: GameState): void {
  const h = gs.homestead;
  if (!h) return;
  const rooms = h.rooms ?? [];
  for (const r of rooms) {
    if (!r.complete) continue;
    if (doorUsable(gs, r)) continue;
    for (const side of ["s", "e", "w", "n"] as const) {
      const d = doorForRect(r, side);
      const out = neighbourOutof(r, d);
      const world = getWorld(gs.seed);
      const insideAny = (h.buildings ?? []).some((b) => rectContains(b, out.x, out.y));
      if (insideAny || !world.inBounds(out.x, out.y)) continue;
      const t = world.tile(out.x, out.y);
      if (!BIOMES[t.biome].passable || world.siteAt(out.x, out.y)) continue;
      if (objectAt(world, out.x, out.y) || roadAt(world, out.x, out.y)) continue;
      r.doors = [d];
      break;
    }
  }
}

/** A doorway is usable when its far side is open air (no homestead structure
 *  on it — ground objects are suppressed by the structure layer) or another
 *  room's interior that shares the doorway. */
function doorUsable(gs: GameState, r: RoomRecord): boolean {
  const h = gs.homestead!;
  for (const d of r.doors) {
    if (!isOnRing(r, d)) continue;
    const out = neighbourOutof(r, d);
    const inside = roomAt(gs, out.x, out.y);
    if (inside && inside.id !== r.id && inside.doors.some((dd) => dd.x === d.x && dd.y === d.y)) return true;
    const covered = (h.buildings ?? []).some((b) => rectContains(b, out.x, out.y));
    if (!covered) return true;
  }
  return false;
}

/* ------------------------------- connectivity -------------------------------- */

/**
 * Which complete rooms of the homestead are reachable from the open air
 * through doorways (Update C.2). Rooms under construction are walls and do
 * not count. Returns roomId → reachable.
 */
export function homesteadConnectivity(gs: GameState): Map<string, boolean> {
  const h = gs.homestead;
  const result = new Map<string, boolean>();
  if (!h) return result;
  const rooms = (h.rooms ?? []).filter((r) => r.complete);
  const world = getWorld(gs.seed);
  const adj = new Map<string, string[]>();
  const exterior = new Set<string>();
  for (const r of rooms) {
    const neighbours = adj.get(r.id) ?? [];
    for (const d of r.doors) {
      const out = neighbourOutof(r, d);
      const other = roomAt(gs, out.x, out.y);
      if (other && other.id !== r.id && other.complete && other.doors.some((dd) => dd.x === d.x && dd.y === d.y)) {
        neighbours.push(other.id);
      } else if (!roomAt(gs, out.x, out.y) && !(h.buildings ?? []).some((b) => rectContains(b, out.x, out.y))) {
        // open air beyond the door — and the ground must be walkable
        if (world.inBounds(out.x, out.y) && BIOMES[world.tile(out.x, out.y).biome].passable) exterior.add(r.id);
      }
    }
    adj.set(r.id, neighbours);
  }
  const q = [...exterior];
  for (const r of rooms) result.set(r.id, false);
  for (const id of exterior) result.set(id, true);
  while (q.length) {
    const id = q.pop()!;
    for (const n of adj.get(id) ?? []) {
      if (!result.get(n)) {
        result.set(n, true);
        q.push(n);
      }
    }
  }
  return result;
}

/** Spoken warning for an edit that would strand a room, or "" when all are reachable. */
export function unreachableWarning(gs: GameState): string {
  const reach = homesteadConnectivity(gs);
  const stranded = [...reach.entries()].filter(([, ok]) => !ok).length;
  if (stranded === 0) return "";
  return `${stranded === 1 ? "A room is" : `${stranded} rooms are`} cut off from every door — knock a doorway through before you fill the walls in.`;
}
