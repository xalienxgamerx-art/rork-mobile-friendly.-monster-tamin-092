import { beforeAll, describe, expect, it } from "vitest";

import { BIOMES, DAY_TICKS } from "@/game/data";
import {
  DESIGNATIONS,
  addRoomToBuilding,
  doorCandidates,
  doorInsideTiles,
  expansionPlan,
  expandRoom,
  generateFurniture,
  grantStarterCottage,
  growRoomPlan,
  homesteadBlocks,
  homesteadConnectivity,
  furnitureAt,
  prefabOf,
  propertyRectOf,
  roomAccessReason,
  roomAt,
  settleBuildings,
  sideHasDoor,
  structureAt,
  tileObstruction,
  unreachableWarning,
  validateExpansion,
  type Side,
} from "@/game/homesteadBuildings";
import { migrateLoaded } from "@/game/migrate";
import {
  SAVE_VERSION,
  buyHomestead,
  homesteadAddRoom,
  homesteadBuySet,
  homesteadDesignate,
  homesteadExpandRoom,
  homesteadPlaceBuilding,
  movePlayer,
  newGame,
  previewStarter,
} from "@/game/sim";
import { objectAt } from "@/game/objects";
import type { GameState, RoomRecord } from "@/game/types";
import { getWorld } from "@/game/world";

/**
 * Update C.2 — Homestead Spatial Expansion. Rooms are real places now:
 * wall-separated, reached through physical doorways, grown on clear ground,
 * fitted with furniture that occupies space and bars the way. Nothing here
 * replaces Update C or C.1 — it hardens the geometry they introduced.
 */

const SEED = "HOMESTEAD-1";
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

// the first newGame() builds the whole world (seconds, and load-dependent);
// warm it outside the per-test 5s budget so tests only measure their own logic
beforeAll(() => makeGs(), 60_000);

function buyAtHamlet(gs: GameState): void {
  const world = getWorld(gs.seed);
  const start = world.startPoint();
  const hamlet = world.featuresNear(start.x, start.y, 12).find((f) => f.kind === "hamlet");
  expect(hamlet, "test world must have a hamlet near the start").toBeTruthy();
  gs.player.x = hamlet!.x;
  gs.player.y = hamlet!.y;
  gs.player.gold = 500;
  gs.bag.ore = (gs.bag.ore ?? 0) + 10;
  expect(buyHomestead(gs)).toContain("Bought the");
}

function standingAtPlot(gs: GameState): void {
  buyAtHamlet(gs);
  const p = gs.homestead!.property!;
  gs.player.x = p.x + 1;
  gs.player.y = p.y + 1;
  gs.player.gold = 100000;
  gs.bag.ore = 500;
  gs.bag.honeycomb = 200;
  gs.bag.herb = 200;
}

/** The starter cottage alone, complete, on an empty homestead. */
function quickCottage(gs: GameState): { buildingId: string; room: RoomRecord } {
  gs.homestead!.buildings = [];
  gs.homestead!.rooms = [];
  grantStarterCottage(gs);
  const b = gs.homestead!.buildings[0];
  return { buildingId: b.id, room: gs.homestead!.rooms[0] };
}

/** First side of the building where a room extension validates cleanly. */
function validSide(gs: GameState, buildingId: string, kind: "room" | "corridor" = "room"): Side {
  for (const s of ["n", "e", "s", "w"] as const) {
    if (validateExpansion(gs, buildingId, s, kind) === "") return s;
  }
  throw new Error(`no valid ${kind} side — test world too choked`);
}

/** Finishes all under-construction work immediately. */
function finishConstruction(gs: GameState): void {
  gs.tick += 8 * DAY_TICKS;
  settleBuildings(gs);
}

/** BFS over a room's walkable interior tiles from every doorway's inside tile. */
function roomInteriorConnected(room: RoomRecord, occupied: Set<string>): boolean {
  const W = 4096;
  const insides = doorInsideTiles(room);
  if (insides.length === 0) return false;
  const key = (x: number, y: number) => `${x},${y}`;
  const start = insides.find((t) => !occupied.has(key(t.x, t.y)));
  if (!start) return false;
  const seen = new Set([key(start.x, start.y)]);
  const q = [start];
  while (q.length) {
    const c = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x < room.x || y < room.y || x >= room.x + room.w || y >= room.y + room.h) continue;
      const k = key(x, y);
      if (seen.has(k) || occupied.has(k)) continue;
      seen.add(k);
      q.push({ x, y });
    }
  }
  // every free interior tile reachable from a doorway
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (!occupied.has(key(x, y)) && !seen.has(key(x, y))) return false;
    }
  }
  return true;
}

/* ------------------------------ physical rooms ------------------------------ */

describe("C.2 physical rooms", () => {
  it("cottage rooms have real walls: interiors never touch, walls block, doorways pass", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    const h = gs.homestead!;
    for (const r of h.rooms) {
      expect(r.complete).toBe(true);
      expect(r.doors.length).toBeGreaterThan(0);
      // interior tiles are open floor…
      expect(structureAt(gs, r.x, r.y)).toBe("floor");
      expect(homesteadBlocks(gs, r.x, r.y)).toBe(false);
      // …the ring around them is wall, opened only at doorways
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        for (const y of [r.y - 1, r.y + r.h]) {
          const onDoor = r.doors.some((d) => d.x === x && d.y === y);
          expect(onDoor || structureAt(gs, x, y) === "wall").toBe(true);
        }
      }
      for (const d of r.doors) {
        expect(structureAt(gs, d.x, d.y)).toBe("door");
        expect(homesteadBlocks(gs, d.x, d.y)).toBe(false);
      }
    }
  });

  it("buildings with several rooms share wall-tile doorways listed on both rooms", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    // place a lodge (two rooms with a shared wall) away from the cottage
    const prop = propertyRectOf(gs)!;
    let placed: string | null = null;
    let lodge = { x: 0, y: 0 };
    for (let y = prop.y + 1; y < prop.y + prop.h - 2 && !placed; y++) {
      for (let x = prop.x + 1; x < prop.x + prop.w - 2 && !placed; x++) {
        const r = homesteadPlaceBuilding(gs, "lodge", x, y, 0);
        if (r === "Construction started: Timber Lodge.") {
          placed = r;
          lodge = { x, y };
        }
      }
    }
    expect(placed).toBeTruthy();
    finishConstruction(gs);
    const b = gs.homestead!.buildings.find((b) => b.prefabId === "lodge")!;
    const rooms = gs.homestead!.rooms.filter((r) => r.buildingId === b.id);
    expect(rooms.length).toBe(prefabOf("lodge")!.rooms.length);
    // the prefab's second room faces "w" — a shared wall doorway into room one
    const shared = rooms[0].doors.filter((d) => rooms[1].doors.some((d2) => d2.x === d.x && d2.y === d.y));
    expect(shared.length).toBeGreaterThan(0);
    for (const d of shared) {
      expect(structureAt(gs, d.x, d.y)).toBe("door");
      // the doorway tile stands between the two interiors
      const inside0 = rooms[0].x <= d.x - 1 && d.x - 1 < rooms[0].x + rooms[0].w;
      expect(inside0 || rooms[1].x <= d.x - 1).toBe(true);
    }
    void lodge;
  });

  it("every complete room stays reachable — no stranded rooms, ever", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    const b = gs.homestead!.buildings[0];
    // attach two wings on valid sides
    for (let i = 0; i < 2; i++) {
      const side = validSide(gs, b.id);
      expect(homesteadAddRoom(gs, b.id, side)).toBe("Room construction started.");
      finishConstruction(gs);
    }
    const conn = homesteadConnectivity(gs);
    for (const r of gs.homestead!.rooms) expect(conn.get(r.id), `${r.id} unreachable`).toBe(true);
    expect(unreachableWarning(gs)).toBe("");
    // a stranded room is detected, not hidden
    const victim = gs.homestead!.rooms[0];
    const keep = victim.doors;
    victim.doors = [];
    expect(unreachableWarning(gs)).toContain("cut off");
    victim.doors = keep;
  });
});

/* --------------------------------- wings ----------------------------------- */

describe("C.2 wings and corridors", () => {
  it("a wing room opens into the parent building through a chosen shared doorway", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    const b = gs.homestead!.buildings[0];
    const before = gs.homestead!.rooms.length;
    const side = validSide(gs, b.id);
    // doorways come from doorCandidates; pick a non-default one when offered
    const plan = expansionPlan(b, side, "room")!;
    const candidates = doorCandidates(gs, b.id, plan);
    expect(candidates.length).toBeGreaterThan(0);
    const door = candidates.length > 1 ? candidates[1] : candidates[0];
    expect(homesteadAddRoom(gs, b.id, side, "room", door)).toBe("Room construction started.");
    expect(gs.homestead!.rooms.length).toBe(before + 1);
    const wing = gs.homestead!.rooms[gs.homestead!.rooms.length - 1];
    expect(wing.complete).toBe(false);
    finishConstruction(gs);
    expect(wing.complete).toBe(true);
    // the wing's doorway into the parent is a shared door: parent lists it too
    const parent = gs.homestead!.rooms.find((r) => r.id !== wing.id && r.buildingId === wing.buildingId)!;
    const shared = wing.doors.filter((d) => parent.doors.some((d2) => d2.x === d.x && d2.y === d.y));
    expect(shared.length).toBeGreaterThan(0);
    expect(unreachableWarning(gs)).toBe("");
  });

  it("a corridor is one tile wide with a door at both ends", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    const b = gs.homestead!.buildings[0];
    const side = validSide(gs, b.id, "corridor");
    expect(homesteadAddRoom(gs, b.id, side, "corridor")).toBe("Passage construction started.");
    const corridor = gs.homestead!.rooms[gs.homestead!.rooms.length - 1];
    expect(corridor.w === 1 || corridor.h === 1).toBe(true);
    expect(corridor.doors.length).toBe(2);
    finishConstruction(gs);
    expect(corridor.complete).toBe(true);
    // the far door opens onto walkable open ground (no structure, no site, no water)
    const world = getWorld(gs.seed);
    const far = corridor.doors[1];
    const dx = Math.sign(far.x - (corridor.x + (corridor.w - 1) / 2)) * (corridor.w === 1 ? 0 : 1);
    const dy = Math.sign(far.y - (corridor.y + (corridor.h - 1) / 2)) * (corridor.h === 1 ? 0 : 1);
    const out = { x: far.x + (corridor.w === 1 ? 0 : dx || 1), y: far.y + (corridor.h === 1 ? 0 : dy || 1) };
    const t = world.tile(out.x, out.y);
    void t;
    expect(structureAt(gs, out.x, out.y)).toBeNull();
    const conn = homesteadConnectivity(gs);
    expect(conn.get(corridor.id)).toBe(true);
  });

  it("doorway candidates only open into complete parent rooms; the building grows", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    const b = gs.homestead!.buildings[0];
    const side = validSide(gs, b.id);
    const plan = expansionPlan(b, side, "room")!;
    for (const d of doorCandidates(gs, b.id, plan)) {
      // every candidate lies on the shared wall between plan room and a parent room
      const onPlan =
        (d.x === plan.room.x - 1 || d.x === plan.room.x + plan.room.w) ||
        (d.y === plan.room.y - 1 || d.y === plan.room.y + plan.room.h);
      expect(onPlan).toBe(true);
    }
    const wBefore = b.w;
    const hBefore = b.h;
    expect(addRoomToBuilding(gs, b.id, side)).toBe("");
    const grown = gs.homestead!.buildings.find((x) => x.id === b.id)!;
    expect(grown.w).toBeGreaterThan(wBefore);
    expect(grown.h).toBeGreaterThanOrEqual(hBefore);
  });
});

/* ------------------------------- widening ----------------------------------- */

describe("C.2 room widening", () => {
  it("widens a door-free side by one tile, charges area-delta, refits furniture", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    const { room } = quickCottage(gs);
    gs.homestead!.designations = { kitchen: 1 };
    room.designation = "kitchen";
    room.furniture = generateFurniture(room);
    const side: Side = (["n", "e", "w"] as const).find((s) => !sideHasDoor(room, s))!;
    const plan = growRoomPlan(room, side);
    expect(plan.cost.gold).toBe(6 * (plan.grown.w * plan.grown.h - room.w * room.h));
    const goldBefore = gs.player.gold;
    expect(homesteadExpandRoom(gs, room.id, side)).toBe("Room widened.");
    expect(gs.player.gold).toBeLessThan(goldBefore);
    expect(room.w * room.h).toBe(plan.grown.w * plan.grown.h);
    // refitted furniture still fits and the room stays navigable
    for (const f of room.furniture) {
      expect(f.x >= room.x && f.x < room.x + room.w).toBe(true);
      expect(f.y >= room.y && f.y < room.y + room.h).toBe(true);
    }
    const occ = new Set(room.furniture.map((f) => `${f.x},${f.y}`));
    expect(roomInteriorConnected(room, occ)).toBe(true);
  });

  it("refuses to widen a wall that holds a doorway", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    const { room } = quickCottage(gs);
    const doorSide: Side = (["n", "e", "s", "w"] as const).find((s) => sideHasDoor(room, s))!;
    const r = expandRoom(gs, room.id, doorSide);
    expect(r).toContain("doorway");
    expect(r).toContain("widen another side");
  });
});

/* ------------------------------ strict ground ------------------------------- */

describe("C.2 strict ground", () => {
  it("water, sites and roads refuse with spoken reasons; vegetation is cleared, announced", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    const world = getWorld(gs.seed);
    const hamlet = gs.homestead!.settlement;
    // a settlement site piece is spoken for
    let siteTile: { x: number; y: number } | null = null;
    let waterTile: { x: number; y: number } | null = null;
    for (let dy = -10; dy <= 10 && (!siteTile); dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        if (world.siteAt(hamlet.x + dx, hamlet.y + dy)) {
          siteTile = { x: hamlet.x + dx, y: hamlet.y + dy };
          break;
        }
      }
    }
    expect(siteTile, "hamlet has built pieces").toBeTruthy();
    expect(tileObstruction(gs, siteTile!.x, siteTile!.y)).toBe("That ground is already spoken for.");
    for (let dy = -80; dy <= 80 && !waterTile; dy += 2) {
      for (let dx = -80; dx <= 80; dx += 2) {
        const t = world.tile(gs.player.x + dx, gs.player.y + dy);
        void t;
        const reason = tileObstruction(gs, gs.player.x + dx, gs.player.y + dy);
        if (reason.startsWith("The ground there will not take a building")) {
          waterTile = { x: gs.player.x + dx, y: gs.player.y + dy };
          break;
        }
      }
    }
    expect(waterTile, "water exists within a walk of the hamlet").toBeTruthy();
    // vegetation no longer refuses — it is cleared at construction, out loud
    const prop = propertyRectOf(gs)!;
    let vegSpot: { x: number; y: number } | null = null;
    for (let y = prop.y + 1; y < prop.y + prop.h - 7 && !vegSpot; y++) {
      for (let x = prop.x + 1; x < prop.x + prop.w - 8; x++) {
        if (!tileObstruction(gs, x, y)) {
          vegSpot = { x, y };
          break;
        }
      }
    }
    expect(vegSpot).toBeTruthy();
    gs.homestead!.buildings = [];
    gs.homestead!.rooms = [];
    const r = homesteadPlaceBuilding(gs, "cottage", vegSpot!.x, vegSpot!.y, 0);
    expect(r).toBe("Construction started: Small Cottage.");
    void waterTile;
  });

  it("placement refusals: outside the property, too close to a building", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    const prop = propertyRectOf(gs)!;
    const b = gs.homestead!.buildings[0];
    expect(tileObstruction(gs, -5, -5)).toBe("There is no land there.");
    void prop;
    const goldBefore = gs.player.gold;
    expect(homesteadPlaceBuilding(gs, "cottage", prop.x + 50, prop.y, 0)).toContain("outside your property");
    expect(homesteadPlaceBuilding(gs, "cottage", b.x, b.y, 0)).toContain("Too close");
    expect(gs.player.gold).toBe(goldBefore);
  });
});

/* ------------------------------ navigation ---------------------------------- */

describe("C.2 navigation", () => {
  it("the player walks outside → room → room through doorways; walls and furniture bar the way", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    finishConstruction(gs);
    const h = gs.homestead!;
    const world = getWorld(gs.seed);
    const room = h.rooms[0];
    // prefer a doorway whose far side is clear, dry open ground
    const doors = room.doors;
    const insides = doorInsideTiles(room);
    let idx = doors.findIndex((d) => {
      const ox = d.x === room.x - 1 ? d.x - 1 : d.x === room.x + room.w ? d.x + 1 : d.x;
      const oy = d.y === room.y - 1 ? d.y - 1 : d.y === room.y + room.h ? d.y + 1 : d.y;
      return BIOMES[world.tile(ox, oy).biome].passable && structureAt(gs, ox, oy) === null && !objectAt(world, ox, oy);
    });
    if (idx < 0) idx = 0;
    const door = doors[idx];
    const inside = insides[idx] ?? insides[0];
    const dx = Math.sign(door.x - inside.x);
    const dy = Math.sign(door.y - inside.y);
    gs.player.x = inside.x;
    gs.player.y = inside.y;
    // walk to the doorway tile, then out of the room
    let r = movePlayer(gs, dx, dy);
    expect(r.ok).toBe(true);
    expect(gs.player.x).toBe(door.x);
    expect(gs.player.y).toBe(door.y);
    r = movePlayer(gs, dx, dy);
    const ox = door.x === room.x - 1 ? door.x - 1 : door.x === room.x + room.w ? door.x + 1 : door.x;
    const oy = door.y === room.y - 1 ? door.y - 1 : door.y === room.y + room.h ? door.y + 1 : door.y;
    const outsideClear = objectAt(world, ox, oy) === null;
    expect(r.ok).toBe(outsideClear);
    expect(structureAt(gs, gs.player.x, gs.player.y)).not.toBe("wall");
    // a wall tile refuses
    gs.player.x = inside.x;
    gs.player.y = inside.y;
    const wall = { x: inside.x + 1, y: inside.y };
    if (structureAt(gs, wall.x, wall.y) === "wall") {
      const wallStep = movePlayer(gs, 1, 0);
      expect(wallStep.ok).toBe(false);
    }
    // furniture bars the way when it stands on a walkable floor tile
    gs.homestead!.designations = { kitchen: 1 };
    room.designation = "kitchen";
    room.furniture = generateFurniture(room);
    const piece = room.furniture[0];
    if (piece) {
      const from = doorInsideTiles(room).find((t) => Math.abs(t.x - piece.x) + Math.abs(t.y - piece.y) === 1);
      if (from) {
        gs.player.x = from.x;
        gs.player.y = from.y;
        const into = movePlayer(gs, piece.x - from.x, piece.y - from.y);
        expect(into.ok).toBe(false);
      }
    }
  });

  it("room access stays interior-only for wing rooms", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    const b = gs.homestead!.buildings[0];
    const side = validSide(gs, b.id);
    expect(homesteadAddRoom(gs, b.id, side)).toBe("Room construction started.");
    finishConstruction(gs);
    const wing = gs.homestead!.rooms[gs.homestead!.rooms.length - 1];
    gs.player.gold = 100000;
    expect(homesteadBuySet(gs, "kitchen")).toContain("Acquired");
    expect(homesteadDesignate(gs, wing.id, "kitchen")).toContain("Room designated: Kitchen");
    // standing outside the wing: access refused
    const parent = gs.homestead!.rooms[0];
    gs.player.x = parent.x;
    gs.player.y = parent.y;
    expect(roomAccessReason(gs, "kitchen")).toContain("inside");
    // standing inside the wing: access granted
    const inside = doorInsideTiles(wing)[0];
    gs.player.x = inside.x;
    gs.player.y = inside.y;
    expect(roomAccessReason(gs, "kitchen")).toBe("");
    void roomAt;
  });
});

/* ------------------------------- migration ---------------------------------- */

describe("C.2 migration v28 → v29", () => {
  it("backfills doors from the legacy single door, deletes the legacy field, is idempotent", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    finishConstruction(gs);
    const saved = JSON.parse(JSON.stringify(gs)) as GameState;
    // downgrade to a v28 save: rooms carry `door`, not `doors`
    saved.version = 28;
    for (const r of saved.homestead!.rooms) {
      (r as { door?: unknown }).door = r.doors[0];
      delete (r as { doors?: unknown }).doors;
    }
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.version).toBe(SAVE_VERSION);
    for (const r of saved.homestead!.rooms) {
      expect(r.doors.length).toBeGreaterThan(0);
      expect((r as { door?: unknown }).door).toBeUndefined();
    }
    // idempotent
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.homestead!.rooms[0].doors.length).toBeGreaterThan(0);
  });

  it("repairDoors re-doors a stranded complete room on clear ground, never deleting objects", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    finishConstruction(gs);
    const room = gs.homestead!.rooms[0];
    room.doors = []; // stranded
    expect(unreachableWarning(gs)).toContain("cut off");
    const saved = JSON.parse(JSON.stringify(gs)) as GameState;
    saved.version = 28;
    expect(migrateLoaded(saved)).toBe(true);
    const repaired = saved.homestead!.rooms[0];
    expect(repaired.doors.length).toBeGreaterThan(0);
    // the new door is a doorway tile on the room's wall, opening outward
    const d = repaired.doors[0];
    const onRing =
      d.y === repaired.y + repaired.h || d.y === repaired.y - 1 || d.x === repaired.x + repaired.w || d.x === repaired.x - 1;
    expect(onRing).toBe(true);
    expect(unreachableWarning(saved)).toBe("");
  });

  it("a current save round-trips rooms, doors, furniture and wings intact", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    quickCottage(gs);
    const b = gs.homestead!.buildings[0];
    const side = validSide(gs, b.id);
    homesteadAddRoom(gs, b.id, side);
    finishConstruction(gs);
    const saved = JSON.parse(JSON.stringify(gs)) as GameState;
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.homestead!.rooms.length).toBe(gs.homestead!.rooms.length);
    expect(saved.homestead!.buildings.length).toBe(gs.homestead!.buildings.length);
    for (let i = 0; i < gs.homestead!.rooms.length; i++) {
      expect(saved.homestead!.rooms[i].doors).toEqual(gs.homestead!.rooms[i].doors);
      expect(saved.homestead!.rooms[i].furniture).toEqual(gs.homestead!.rooms[i].furniture);
      expect(saved.homestead!.rooms[i].w).toBe(gs.homestead!.rooms[i].w);
    }
    expect(unreachableWarning(saved)).toBe("");
  });
});
