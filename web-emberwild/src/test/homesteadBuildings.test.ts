import { beforeAll, describe, expect, it } from "vitest";

import { DAY_TICKS } from "@/game/data";
import {
  DESIGNATIONS,
  DESIGNATION_ORDER,
  PREFABS,
  addRoomToBuilding,
  assignDesignation,
  buyDesignationSet,
  canPlaceBuilding,
  doorForRect,
  expansionPlan,
  validateExpansion,
  generateFurniture,
  grantStarterCottage,
  homesteadBlocks,
  homesteadTileMap,
  layoutOf,
  prefabOf,
  propertyRectOf,
  rectContains,
  roomAccessReason,
  roomAt,
  settleBuildings,
  structureAt,
  suitability,
  type Side,
} from "@/game/homesteadBuildings";
import { migrateLoaded } from "@/game/migrate";
import {
  SAVE_VERSION,
  buyHomestead,
  homesteadAddRoom,
  homesteadBuild,
  homesteadBuySet,
  homesteadDeposit,
  homesteadDesignate,
  homesteadPlaceBuilding,
  homesteadRest,
  homesteadWithdraw,
  newGame,
  nurseryStoreEgg,
  nurseryTakeBackEgg,
  previewStarter,
  swapPartyPenGuarded,
} from "@/game/sim";
import { rollGenome } from "@/game/genetics";
import { Rng } from "@/game/rng";
import type { ChildBlueprint, GameState, PersonalityId, RoomRecord } from "@/game/types";
import { getWorld } from "@/game/world";

const child = (speciesId = "mossback"): ChildBlueprint => ({
  speciesId,
  sex: "female",
  level: 1,
  genes: rollGenome(new Rng(7), speciesId),
  mutations: [],
  personality: "steady" as PersonalityId,
  skills: [],
  plus: 1,
  bond: 40,
  generation: 1,
  lineageId: "L1",
  mutHistory: [],
  parents: ["pa", "pb"],
  parentNames: ["Rowan", "Sorrel"],
});

/** A carried egg ready to rack. */
function carryEgg(gs: GameState): { id: string } {
  const egg = {
    id: `egg${gs.eggs?.length ?? 0}`,
    speciesId: "mossback",
    child: child(),
    stolenTick: gs.tick,
    hatchTick: gs.tick + 1000,
  };
  gs.eggs = gs.eggs ?? [];
  gs.eggs.push(egg as never);
  return egg;
}

/**
 * Update C.1 — Modular Homestead Construction and Room Design. Prefab
 * buildings on real world tiles, individually priced rooms, permanent
 * designation sets, auto-generated furniture, and room-based physical access
 * gating — layered on top of Update C, never replacing it.
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

/** Places a cottage instantly (complete) and returns its single room. */
function quickCottage(gs: GameState): { buildingId: string; room: RoomRecord } {
  gs.homestead!.buildings = [];
  gs.homestead!.rooms = [];
  grantStarterCottage(gs);
  const b = gs.homestead!.buildings[0];
  return { buildingId: b.id, room: gs.homestead!.rooms[0] };
}

/** Scans the property for a valid placement spot for a prefab (both rotations). */
function findSpot(gs: GameState, prefabId: string, rot: 0 | 90 = 0): { x: number; y: number } | null {
  const prop = gs.homestead!.property!;
  for (const r of [rot, rot === 0 ? 90 : 0] as const) {
    for (let y = prop.y + 1; y < prop.y + prop.h - 2; y++) {
      for (let x = prop.x + 1; x < prop.x + prop.w - 2; x++) {
        if (!canPlaceBuilding(gs, prefabId, x, y, r)) return { x, y };
      }
    }
  }
  return null;
}

/** A complete, affordable, designated room of the given kind, player inside. */
function roomReady(gs: GameState, facility: keyof typeof DESIGNATIONS): RoomRecord {
  standingAtPlot(gs);
  gs.homestead!.buildings = [];
  gs.homestead!.rooms = [];
  grantStarterCottage(gs);
  gs.homestead!.designations = { [facility]: 1 };
  const room = gs.homestead!.rooms[0];
  room.designation = facility;
  room.furniture = generateFurniture(room);
  gs.player.x = room.x;
  gs.player.y = room.y;
  return room;
}

/* --------------------------------- prefabs ---------------------------------- */

describe("C.1 prefabs", () => {
  it("every prefab's rooms are true rooms: wall-separated, inside the walls", () => {
    for (const p of PREFABS) {
      // every room fits inside the walls…
      for (const r of p.rooms) {
        expect(r.x).toBeGreaterThanOrEqual(1);
        expect(r.y).toBeGreaterThanOrEqual(1);
        expect(r.x + r.w).toBeLessThanOrEqual(p.w - 1);
        expect(r.y + r.h).toBeLessThanOrEqual(p.h - 1);
      }
      // …and no two rooms touch: a full wall tile always stands between them
      for (let i = 0; i < p.rooms.length; i++) {
        for (let j = i + 1; j < p.rooms.length; j++) {
          const a = p.rooms[i];
          const b = p.rooms[j];
          const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
          const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
          expect(Math.max(gapX, gapY), `${p.id} rooms ${i}/${j} share open plan`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("rotation swaps footprint dims and keeps doorways on room walls", () => {
    const p = prefabOf("lodge")!;
    const rotated = layoutOf(p, 100, 100, 90);
    // lodge 11×8 → rotated 8×11
    for (const r of rotated) {
      expect(r.rect.x).toBeGreaterThanOrEqual(100);
      expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(100 + p.h);
      expect(r.rect.y).toBeGreaterThanOrEqual(100);
      expect(r.rect.y + r.rect.h).toBeLessThanOrEqual(100 + p.w);
      // every doorway sits on the room's wall ring, outside the interior
      for (const d of r.doors) {
        const onEdge = d.y === r.rect.y + r.rect.h || d.y === r.rect.y - 1 || d.x === r.rect.x + r.rect.w || d.x === r.rect.x - 1;
        expect(onEdge).toBe(true);
      }
      expect(r.doors.length).toBeGreaterThan(0);
    }
  });

  it("doorForRect centres the door on the chosen side", () => {
    expect(doorForRect({ x: 10, y: 10, w: 5, h: 4 }, "s")).toEqual({ x: 12, y: 14 });
    expect(doorForRect({ x: 10, y: 10, w: 5, h: 4 }, "n")).toEqual({ x: 12, y: 9 });
    expect(doorForRect({ x: 10, y: 10, w: 5, h: 4 }, "e")).toEqual({ x: 15, y: 12 });
    expect(doorForRect({ x: 10, y: 10, w: 5, h: 4 }, "w")).toEqual({ x: 9, y: 12 });
  });
});

/* --------------------------------- placement --------------------------------- */

describe("C.1 building placement", () => {
  it("new homesteads get a free starter cottage inside the property bounds", () => {
    const gs = makeGs();
    buyAtHamlet(gs);
    const h = gs.homestead!;
    expect(h.buildings!.length).toBe(1);
    expect(h.buildings![0].prefabId).toBe("cottage");
    expect(h.buildings![0].complete).toBe(true);
    const prop = h.property!;
    const b = h.buildings![0];
    expect(b.x).toBeGreaterThanOrEqual(prop.x);
    expect(b.x + b.w).toBeLessThanOrEqual(prop.x + prop.w);
    expect(b.y + b.h).toBeLessThanOrEqual(prop.y + prop.h);
    expect(h.rooms!.length).toBe(1);
    expect(h.rooms![0].designation).toBe("undesignated");
  });

  it("rejects placement outside the property, on overlaps, and on blocked ground — without charging", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    const prop = gs.homestead!.property!;
    const gold = gs.player.gold;
    const ore = gs.bag.ore;
    // far outside
    expect(canPlaceBuilding(gs, "cottage", prop.x + 50, prop.y)).toContain("outside your property");
    expect(homesteadPlaceBuilding(gs, "cottage", prop.x + 50, prop.y, 0)).toContain("outside your property");
    // overlapping the existing cottage (too close — 1 tile gap required)
    const b = gs.homestead!.buildings[0];
    expect(canPlaceBuilding(gs, "cottage", b.x, b.y, 0)).toContain("Too close");
    expect(gs.player.gold).toBe(gold);
    expect(gs.bag.ore).toBe(ore);
    // valid placement away from the cottage
    const spot = findSpot(gs, "cottage");
    expect(spot).toBeTruthy();
    const r = homesteadPlaceBuilding(gs, "cottage", spot!.x, spot!.y, 0);
    expect(r).toBe("Construction started: Small Cottage.");
    expect(gs.player.gold).toBeLessThan(gold);
  });

  it("under-construction buildings are solid scaffolding; complete ones open through doors", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    grantStarterCottage(gs);
    // fresh cottage is instant-complete; place a second, unfinished one
    const spot = findSpot(gs, "lodge");
    expect(spot).toBeTruthy();
    const ok = homesteadPlaceBuilding(gs, "lodge", spot!.x, spot!.y, 0);
    expect(ok).toBe("Construction started: Timber Lodge.");
    const lodge = gs.homestead!.buildings.find((b) => b.prefabId === "lodge")!;
    expect(lodge.complete).toBe(false);
    expect(structureAt(gs, lodge.x + 1, lodge.y + 1)).toBe("wall"); // scaffolding
    expect(homesteadBlocks(gs, lodge.x + 1, lodge.y + 1)).toBe(true);
    // the complete cottage: interior is floor, walls block, door passes
    const cottage = gs.homestead!.buildings.find((b) => b.prefabId === "cottage")!;
    const room = gs.homestead!.rooms.find((r) => r.buildingId === cottage.id)!;
    expect(structureAt(gs, room.x, room.y)).toBe("floor");
    expect(homesteadBlocks(gs, room.x, room.y)).toBe(false);
    expect(structureAt(gs, room.doors[0].x, room.doors[0].y)).toBe("door");
    expect(homesteadBlocks(gs, room.doors[0].x, room.doors[0].y)).toBe(false);
    expect(structureAt(gs, cottage.x, cottage.y)).toBe("wall");
    expect(homesteadBlocks(gs, cottage.x, cottage.y)).toBe(true);
  });

  it("construction settles over sim time for buildings and rooms alike", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    gs.homestead!.buildings = [];
    gs.homestead!.rooms = [];
    const spot = findSpot(gs, "barn");
    expect(spot).toBeTruthy();
    const placed = homesteadPlaceBuilding(gs, "barn", spot!.x, spot!.y, 0);
    expect(placed).toBe("Construction started: Field Barn.");
    const barn = gs.homestead!.buildings.find((b) => b.prefabId === "barn")!;
    expect(barn.complete).toBe(false);
    // advance past its buildTicks (96) plus margin
    gs.tick += 4 * DAY_TICKS;
    settleBuildings(gs);
    expect(barn.complete).toBe(true);
    const room = gs.homestead!.rooms.find((r) => r.buildingId === barn.id)!;
    expect(room.complete).toBe(true);
  });
});

/* ------------------------------- rooms & sets -------------------------------- */

describe("C.1 rooms and designation sets", () => {
  it("room costs scale with area and are charged atomically", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    grantStarterCottage(gs);
    const b = gs.homestead!.buildings[0];
    const gold = gs.player.gold;
    const ore = gs.bag.ore;
    // find a side where the extension actually fits (ground, bounds, doorway)
    gs.player.gold = 100000;
    const sides: Side[] = ["n", "e", "s", "w"];
    const side = sides.find((s) => validateExpansion(gs, b.id, s, "room") === "");
    expect(side, "some side of the cottage must take a room").toBeTruthy();
    const plan = expansionPlan(b, side!, "room")!;
    expect(plan.cost.gold).toBe(6 * plan.room.w * plan.room.h + 24);
    expect(plan.cost.items.ore).toBe(Math.ceil((plan.room.w * plan.room.h) / 5));
    gs.player.gold = plan.cost.gold - 1; // just short
    const r = addRoomToBuilding(gs, b.id, side!);
    expect(r).toContain("lack the means");
    expect(gs.homestead!.rooms.length).toBe(1);
    expect(gs.player.gold).toBe(plan.cost.gold - 1); // unchanged by the failed attempt
    gs.player.gold = 100000;
    expect(addRoomToBuilding(gs, b.id, side!)).toBe("");
    expect(gs.homestead!.rooms.length).toBe(2);
    expect(gs.player.gold).toBeLessThan(gold);
    const added = gs.homestead!.rooms[1];
    expect(added.complete).toBe(false);
    expect(added.completeTick).toBeGreaterThan(gs.tick - 1);
  });

  it("designation sets are permanent, one-time purchases; duplicates refuse", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    const def = DESIGNATIONS.kitchen;
    gs.player.gold = def.cost.gold - 1;
    gs.bag.ore = def.cost.items.ore ?? 0;
    expect(homesteadBuySet(gs, "kitchen")).toContain("lack the means");
    expect(gs.homestead!.designations?.kitchen).toBeUndefined();
    gs.player.gold = 1000;
    expect(homesteadBuySet(gs, "kitchen")).toContain("Acquired the Kitchen set.");
    expect(gs.homestead!.designations?.kitchen).toBe(1);
    expect(homesteadBuySet(gs, "kitchen")).toContain("already hold");
    // persistence survives the migration round-trip
    const saved = JSON.parse(JSON.stringify({ ...gs, version: SAVE_VERSION }));
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.homestead!.designations?.kitchen).toBe(1);
  });

  it("designation requires the set, and data-driven suitability gates room size", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    const { room } = quickCottage(gs); // 5×4 room
    // set not owned
    expect(assignDesignation(gs, room.id, "breeding")).toContain("designation set");
    gs.homestead!.designations = { breeding: 1 };
    // breeding needs 5×4 minimum — a 5×4 room just fits
    expect(suitability(room, "breeding")).toBe("");
    expect(assignDesignation(gs, room.id, "breeding")).toBe("");
    expect(room.designation).toBe("breeding");
    // a smaller room fails suitability
    const gs2 = makeGs();
    standingAtPlot(gs2);
    const { room: small } = quickCottage(gs2);
    small.w = 3;
    small.h = 3;
    gs2.homestead!.designations = { breeding: 1 };
    expect(suitability(small, "breeding")).toContain("5×4");
    expect(assignDesignation(gs2, small.id, "breeding")).toContain("5×4");
    // clearing a designation is always allowed
    expect(assignDesignation(gs, room.id, "undesignated")).toBe("");
    expect(room.designation).toBe("undesignated");
    expect(room.furniture.length).toBe(0);
  });

  it("furniture is auto-generated, deterministic, functional-first, decorative never unlocking gameplay", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    const { room } = quickCottage(gs);
    gs.homestead!.designations = { kitchen: 1 };
    room.designation = "kitchen";
    const f1 = generateFurniture(room);
    const f2 = generateFurniture(room);
    expect(f1).toEqual(f2); // deterministic
    expect(f1.some((f) => f.kind === "stove" && !f.decorative)).toBe(true);
    for (const f of f1) {
      // every piece stands inside its room and never on a doorway mouth
      expect(rectContains(room, f.x, f.y)).toBe(true);
      for (const d of room.doors) expect(f.x === d.x && f.y === d.y).toBe(false);
    }
    // undesignated rooms stay bare
    room.designation = "undesignated";
    expect(generateFurniture(room)).toEqual([]);
  });

  it("designation hot-swap regenerates furniture and never destroys stored goods", () => {
    const gs = makeGs();
    const room = roomReady(gs, "storage");
    // build the cellar facility (capacity lives there, Update C) and store homestead-wide
    expect(homesteadBuild(gs, "storage")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.storage.completeTick!;
    gs.bag.ore = 10;
    expect(homesteadDeposit(gs, "ore", 5)).toContain("Stored 5");
    expect(gs.homestead!.storage.ore).toBe(5);
    gs.homestead!.designations = { storage: 1, kitchen: 1 };
    expect(homesteadDesignate(gs, room.id, "kitchen")).toContain("Room designated: Kitchen.");
    expect(room.designation).toBe("kitchen");
    expect(room.furniture.some((f) => f.kind === "stove")).toBe(true);
    // the cellar's contents are untouched by the conversion — re-designate and withdraw
    expect(gs.homestead!.storage.ore).toBe(5);
    expect(homesteadDesignate(gs, room.id, "storage")).toContain("Room designated: Store Room.");
    expect(homesteadWithdraw(gs, "ore", -1)).toContain("Took 5");
  });
});

/* ------------------------------- physical access ------------------------------ */

describe("C.1 physical room access", () => {
  it("denies access off the property, outside rooms, in wrong rooms, before completion, without the set", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    grantStarterCottage(gs);
    gs.homestead!.designations = { storage: 1 };
    const room = gs.homestead!.rooms[0];
    // off the property
    gs.player.x = gs.homestead!.x + 40;
    gs.player.y = gs.homestead!.y;
    expect(roomAccessReason(gs, "storage")).toContain("travel there and step inside");
    // on the property but outside any room
    gs.player.x = gs.homestead!.property!.x + 1;
    gs.player.y = gs.homestead!.property!.y + 1;
    expect(roomAccessReason(gs, "storage")).toContain("Step inside your store room");
    // standing in the room, but undesignated
    gs.player.x = room.x;
    gs.player.y = room.y;
    expect(roomAccessReason(gs, "storage")).toContain("undesignated");
    // designated but incomplete
    room.designation = "storage";
    room.complete = false;
    expect(roomAccessReason(gs, "storage")).toContain("still being raised");
    // complete and designated: granted
    room.complete = true;
    expect(roomAccessReason(gs, "storage")).toBe("");
    // wrong room designation
    expect(roomAccessReason(gs, "kitchen")).toContain("stand inside your kitchen");
  });

  it("game actions are re-gated on room access: cellar, nursery, pen swap, bedroom rest", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    grantStarterCottage(gs);
    const room = gs.homestead!.rooms[0];
    // storage without standing in the room
    expect(homesteadDeposit(gs, "ore", 1)).toContain("Step inside");
    expect(homesteadWithdraw(gs, "ore", 1)).toContain("Step inside");
    // nursery without the room
    const egg = carryEgg(gs);
    expect(nurseryStoreEgg(gs, egg.id)).toContain("Step inside");
    // bedroom rest outside the room
    expect(homesteadRest(gs)).toContain("Step inside");
    // pen swap far from everything requires a housing room
    expect(swapPartyPenGuarded(gs, "nobody")).toContain("Step inside");
    // now stand in a proper store room (with the cellar facility built): deposit works
    expect(homesteadBuild(gs, "storage")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.storage.completeTick!;
    gs.homestead!.designations = { storage: 1 };
    room.designation = "storage";
    gs.player.x = room.x;
    gs.player.y = room.y;
    expect(homesteadDeposit(gs, "ore", 2)).toContain("Stored 2");
    // and a bedroom next door is still not a store room
    room.designation = "bedroom";
    expect(homesteadDeposit(gs, "ore", 1)).toContain("bedroom");
  });

  it("overview can look, but never act: room functions need the player inside", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    grantStarterCottage(gs);
    // the tile map lets the renderer show status from anywhere…
    const map = homesteadTileMap(gs);
    expect(map.size).toBeGreaterThan(0);
    // …but every functional gate is a physical one
    for (const f of DESIGNATION_ORDER) {
      const reason = roomAccessReason(gs, f);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------- migration --------------------------------- */

describe("C.1 migration", () => {
  it("backfills v28 fields on old v27 homesteads and grants the compatibility cottage", () => {
    const gs = makeGs();
    buyAtHamlet(gs);
    const h = gs.homestead!;
    // simulate a v27 save: no property, buildings, rooms, sets
    delete h.property;
    h.buildings = [];
    h.rooms = [];
    h.designations = {};
    h.style = undefined;
    h.facilities.pens = { level: 2 };
    h.facilities.storage = { level: 1 };
    migrateLoaded(gs);
    const h2 = gs.homestead!;
    expect(h2.property).toBeTruthy();
    expect(h2.buildings!.length).toBe(1);
    expect(h2.buildings![0].complete).toBe(true);
    // rooms designated to match owned facilities; sets granted free
    const desigs = h2.rooms!.map((r) => r.designation).sort();
    expect(desigs).toEqual(["housing", "storage"]);
    expect(h2.designations!.housing).toBe(1);
    expect(h2.designations!.storage).toBe(1);
    expect(h2.rooms!.every((r) => r.complete)).toBe(true);
    // facility levels stay authoritative
    expect(h2.facilities.pens.level).toBe(2);
  });

  it("migration is idempotent and preserves Update A/B/C state", () => {
    const gs = makeGs();
    buyAtHamlet(gs);
    const h = gs.homestead!;
    h.facilities.pens = { level: 1 };
    migrateLoaded(gs);
    const after1 = JSON.stringify(gs.homestead);
    migrateLoaded(gs);
    expect(JSON.stringify(gs.homestead)).toBe(after1);
    expect(gs.homestead!.buildings!.length).toBe(1);
    expect(gs.homestead!.storage).toEqual({});
    expect(gs.version).toBe(SAVE_VERSION);
  });
});
