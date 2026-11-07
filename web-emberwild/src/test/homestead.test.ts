import { beforeAll, describe, expect, it } from "vitest";

import { BIOMES, PEN_MAX, PERSONALITIES } from "@/game/data";
import {
  FACILITIES,
  PLOT_COST,
  findPlot,
  isAtHomestead,
  levelOf,
  migrateHomestead,
  nurseryCapacityOf,
  nurseryEggs,
  penCapacityOf,
  storageCapacityOf,
  storageUsedOf,
} from "@/game/homestead";
import { PACK_EGG_CAP, eggReady, hatchCarriedEgg, takeEggIntoPack } from "@/game/eggs";
import { migrateLoaded } from "@/game/migrate";
import { SAVE_VERSION, buyHomestead, homesteadBuild, homesteadDeposit, homesteadWithdraw, newGame, nurseryStoreEgg, nurseryTakeBackEgg, previewStarter, recruit, swapPartyPen } from "@/game/sim";
import { rollGenome } from "@/game/genetics";
import { Rng } from "@/game/rng";
import type { ChildBlueprint, GameState, ItemId, PersonalityId, RoomFacility, RoomRecord } from "@/game/types";
import { getWorld } from "@/game/world";

/**
 * Update C — The Monster Homestead. Permanent property, data-driven
 * facilities, pens as capacity expansion of the existing pen, shared ItemId
 * storage, breeding grounds over the existing rites, and a nursery that frees
 * pack slots without a second incubation clock.
 */

const SEED = "HOMESTEAD-1";
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

// the first newGame() builds the whole world (seconds, and load-dependent);
// warm it outside the per-test 5s budget so tests only measure their own logic
beforeAll(() => makeGs(), 60_000);

/** Teleports the player into the nearest hamlet and buys the plot. */
function buyAtHamlet(gs: GameState): void {
  const world = getWorld(gs.seed);
  const start = world.startPoint();
  const hamlet = world.featuresNear(start.x, start.y, 12).find((f) => f.kind === "hamlet");
  expect(hamlet, "test world must have a hamlet near the start").toBeTruthy();
  gs.player.x = hamlet!.x;
  gs.player.y = hamlet!.y;
  gs.player.gold = 500;
  gs.bag.ore = (gs.bag.ore ?? 0) + 10;
  const r = buyHomestead(gs);
  expect(r).toBe(`Bought the ${hamlet!.name} Homestead plot.`);
}

/** Buys the plot and stands the player on it, with deep pockets and full materials. */
function standingAtPlot(gs: GameState): void {
  buyAtHamlet(gs);
  gs.player.x = gs.homestead!.x;
  gs.player.y = gs.homestead!.y;
  gs.player.gold = 10000;
  gs.bag.ore = 200;
  gs.bag.honeycomb = 100;
  gs.bag.herb = 100;
}

/**
 * Update C.1: since room functions are gated on physical presence, tests that
 * exercise a facility's function stand inside a starter-cottage room
 * designated for it (with the set granted, as the compatibility path does).
 */
function designateRoom(gs: GameState, f: RoomFacility): RoomRecord {
  const h = gs.homestead!;
  h.designations = { ...(h.designations ?? {}), [f]: 1 };
  const room = h.rooms![0];
  room.designation = f;
  gs.player.x = room.x;
  gs.player.y = room.y;
  return room;
}

const give = (gs: GameState, item: ItemId, n: number): void => {
  gs.bag[item] = (gs.bag[item] ?? 0) + n;
};

const child = (speciesId = "mossback"): ChildBlueprint => ({
  speciesId,
  sex: "female",
  level: 1,
  genes: rollGenome(new Rng(7), speciesId),
  mutations: [],
  personality: Object.keys(PERSONALITIES)[0] as PersonalityId,
  skills: [],
  plus: 1,
  bond: 40,
  generation: 1,
  lineageId: "L1",
  mutHistory: [],
  parents: ["pa", "pb"],
  parentNames: ["Rowan", "Sorrel"],
});

/* --------------------------------- property ---------------------------------- */

describe("homestead property", () => {
  it("starts with no homestead", () => {
    const gs = makeGs();
    expect(gs.homestead).toBeUndefined();
    expect(isAtHomestead(gs)).toBe(false);
  });

  it("is bought from a settlement for the plot price, paid in full", () => {
    const gs = makeGs();
    const oreBefore = gs.bag.ore ?? 0;
    gs.bag.ore = oreBefore;
    buyAtHamlet(gs);
    const h = gs.homestead!;
    expect(h.id).toMatch(/^h:\d+:\d+$/);
    expect(h.name).toContain("Homestead");
    expect(h.settlement.id).toMatch(/^s:\d+:\d+$/); // settlement recorded
    expect(h.boughtTick).toBeLessThanOrEqual(gs.tick);
    expect(h.facilities).toEqual({});
    expect(h.storage).toEqual({});
    expect(gs.player.gold).toBe(500 - PLOT_COST.gold);
    expect(gs.bag.ore).toBe(10 - (PLOT_COST.items.ore ?? 0));
  });

  it("places the plot on passable open ground just outside the settlement", () => {
    const gs = makeGs();
    buyAtHamlet(gs);
    const h = gs.homestead!;
    const world = getWorld(gs.seed);
    expect(BIOMES[world.tile(h.x, h.y).biome].passable).toBe(true);
    expect(world.siteAt(h.x, h.y)).toBeNull();
    const half = 11 + 2; // hamlet footprint 23 → ring starts at ceil(23/2)+2
    const dx = Math.abs(h.x - h.settlement.x);
    const dy = Math.abs(h.y - h.settlement.y);
    expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(half);
    expect(findPlot(gs.seed, h.settlement.x, h.settlement.y, "hamlet")).toEqual({ x: h.x, y: h.y });
  });

  it("is deterministic: the same settlement always grants the same plot", () => {
    const a = makeGs();
    buyAtHamlet(a);
    const b = makeGs();
    buyAtHamlet(b);
    expect(a.homestead!.x).toBe(b.homestead!.x);
    expect(a.homestead!.y).toBe(b.homestead!.y);
  });

  it("rejects a second purchase and a purchase away from settlements", () => {
    const gs = makeGs();
    buyAtHamlet(gs);
    expect(buyHomestead(gs)).toContain("already");
    const wild = makeGs();
    // walk out into the open wilds, far from any settlement
    const world = getWorld(wild.seed);
    const start = world.startPoint();
    wild.player.x = start.x + 150;
    wild.player.y = start.y + 150;
    expect(buyHomestead(wild)).toContain("settlement");
  });

  it("rejects buyers who cannot pay gold or lack the materials", () => {
    const gs = makeGs();
    const world = getWorld(gs.seed);
    const start = world.startPoint();
    const hamlet = world.featuresNear(start.x, start.y, 12).find((f) => f.kind === "hamlet")!;
    gs.player.x = hamlet.x;
    gs.player.y = hamlet.y;
    gs.player.gold = 10;
    expect(buyHomestead(gs)).toContain("afford");
    gs.player.gold = 500;
    expect(buyHomestead(gs)).toContain("afford"); // no Glintstone in the bag
    expect(gs.homestead).toBeUndefined();
  });
});

/* -------------------------------- facilities --------------------------------- */

describe("homestead facilities", () => {
  it("require standing on the plot", () => {
    const gs = makeGs();
    buyAtHamlet(gs);
    gs.player.x += 40;
    expect(homesteadBuild(gs, "pens")).toContain("stand at your homestead");
  });

  it("take validated costs atomically and finish on sim time", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "pens")).toContain("Construction started");
    const h = gs.homestead!;
    expect(gs.player.gold).toBe(10000 - FACILITIES.pens.costs[0].gold);
    expect(gs.bag.ore).toBe(200 - (FACILITIES.pens.costs[0].items.ore ?? 0));
    expect(levelOf(gs, "pens")).toBe(0); // not yet
    expect(h.facilities.pens.building).toBe(1);
    const done = h.facilities.pens.completeTick!;
    expect(done).toBeGreaterThan(gs.tick);
    // time passes — construction completes without any further action
    gs.tick = done;
    expect(levelOf(gs, "pens")).toBe(1);
    expect(h.facilities.pens.building).toBeUndefined();
    expect(penCapacityOf(gs)).toBe(PEN_MAX + (FACILITIES.pens.effects.penCapacity ?? 0));
  });

  it("reject unaffordable builds without spending anything", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    gs.player.gold = 1;
    const before = JSON.stringify(gs.bag);
    expect(homesteadBuild(gs, "storage")).toContain("lack the means");
    expect(JSON.stringify(gs.bag)).toBe(before);
    expect(gs.player.gold).toBe(1);
  });

  it("respect the level ladder and cap out", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "breeding")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.breeding.completeTick!;
    expect(levelOf(gs, "breeding")).toBe(1);
    // breeding grounds are single-level: the next attempt refuses
    expect(homesteadBuild(gs, "breeding")).toContain("finest");
    expect(FACILITIES.breeding.maxLevel).toBe(1);
  });

  it("scale their effects with levels (pens, cellar, nursery)", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(storageCapacityOf(gs)).toBe(0);
    expect(nurseryCapacityOf(gs)).toBe(0);
    expect(homesteadBuild(gs, "storage")).toContain("Construction started");
    expect(homesteadBuild(gs, "nursery")).toContain("Construction started");
    gs.tick = Math.max(gs.homestead!.facilities.storage.completeTick!, gs.homestead!.facilities.nursery.completeTick!);
    expect(storageCapacityOf(gs)).toBe(80);
    expect(nurseryCapacityOf(gs)).toBe(2);
    expect(homesteadBuild(gs, "storage")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.storage.completeTick!;
    expect(storageCapacityOf(gs)).toBe(160);
    expect(penCapacityOf(gs)).toBe(PEN_MAX); // no pens built yet — base is untouched
  });

  it("keep future facilities out of reach", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "kitchen")).toContain("not something you can build");
    expect(homesteadBuild(gs, "garden")).toContain("not something you can build");
  });
});

/* ----------------------------------- pens ------------------------------------ */

describe("homestead pens", () => {
  it("raise pen capacity for every existing overflow path", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "pens")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.pens.completeTick!;
    const cap = penCapacityOf(gs);
    expect(cap).toBe(PEN_MAX + 6);
    // fill the pen to one below the new capacity, then verify the swap crosses the old base ceiling
    for (let i = gs.pen.length; i < cap - 1; i++) {
      gs.pen.push({ ...gs.party[0], uid: `fill${i}` });
    }
    expect(gs.pen.length).toBe(cap - 1);
    // a second party member lets the starter swap out — past the old base ceiling
    gs.party.push({ ...gs.party[0], uid: "sidekick" });
    expect(swapPartyPen(gs, gs.party[0].uid)).toContain("goes to the pen");
    expect(gs.pen.length).toBe(cap);
    expect(gs.pen.length).toBeGreaterThan(PEN_MAX);
  });

  it("keep the base capacity untouched without the facility", () => {
    const gs = makeGs();
    expect(penCapacityOf(gs)).toBe(PEN_MAX);
  });

  it("route overflow recruits through the raised capacity", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "pens")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.pens.completeTick!;
    while (gs.party.length < 4) gs.party.push({ ...gs.party[0], uid: `p${gs.party.length}` });
    const mon = { ...gs.party[0], uid: "overflow" };
    expect(recruit(gs, mon)).toContain("heads to the pen");
    // the pen was empty before, so this only proves the recruit path uses the shared capacity — fill to cap:
    for (let i = gs.pen.length; i < penCapacityOf(gs); i++) gs.pen.push({ ...gs.party[0], uid: `f${i}` });
    const stray = { ...gs.party[0], uid: "stray" };
    expect(recruit(gs, stray)).toContain("wanders off");
  });
});

/* ---------------------------------- storage ---------------------------------- */

describe("homestead storage", () => {
  it("round-trips goods between bag and cellar without loss", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "storage")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.storage.completeTick!;
    designateRoom(gs, "storage");
    give(gs, "berries", 10);
    expect(homesteadDeposit(gs, "berries", 4)).toContain("Stored 4");
    expect(gs.bag.berries).toBe(6);
    expect(gs.homestead!.storage.berries).toBe(4);
    expect(storageUsedOf(gs)).toBe(4);
    expect(homesteadWithdraw(gs, "berries", 10)).toContain("Took 4");
    expect(gs.bag.berries).toBe(10);
    expect(gs.homestead!.storage.berries).toBeUndefined();
    expect(storageUsedOf(gs)).toBe(0);
  });

  it("stores everything with qty -1 and deletes emptied bag stacks", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "storage")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.storage.completeTick!;
    designateRoom(gs, "storage");
    gs.bag.herb = 7;
    expect(homesteadDeposit(gs, "herb", -1)).toContain("Stored 7");
    expect(gs.bag.herb).toBeUndefined();
    expect(gs.homestead!.storage.herb).toBe(7);
  });

  it("enforces capacity atomically — nothing moves when it does not fit", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "storage")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.storage.completeTick!;
    designateRoom(gs, "storage");
    give(gs, "berries", 100);
    expect(homesteadDeposit(gs, "berries", -1)).toContain("the cellar is now full");
    expect(storageUsedOf(gs)).toBe(80);
    expect(gs.bag.berries).toBe(20);
    expect(gs.homestead!.storage.berries).toBe(80);
    // full now: a deposit of anything else moves nothing
    gs.bag.herb = 3;
    expect(homesteadDeposit(gs, "herb", 1)).toContain("full");
    expect(gs.bag.herb).toBe(3);
    expect(gs.homestead!.storage.herb).toBeUndefined();
  });

  it("refuse to work away from the store room or without a cellar", () => {
    const gs = makeGs();
    standingAtPlot(gs);
    give(gs, "berries", 5);
    designateRoom(gs, "storage");
    expect(homesteadDeposit(gs, "berries", 1)).toContain("cellar"); // no cellar built → capacity 0 → full
    gs.player.x = 5;
    gs.player.y = 5;
    expect(homesteadDeposit(gs, "berries", 1)).toContain("travel there and step inside");
  });
});

/* ---------------------------------- nursery ---------------------------------- */

describe("homestead nursery", () => {
  function readyNursery(gs: GameState): void {
    standingAtPlot(gs);
    expect(homesteadBuild(gs, "nursery")).toContain("Construction started");
    gs.tick = gs.homestead!.facilities.nursery.completeTick!;
    designateRoom(gs, "nursery");
  }

  it("racks eggs, freeing pack slots — no second timer, incubation just continues", () => {
    const gs = makeGs();
    readyNursery(gs);
    // fill the pack with eggs (4 = cap)
    for (let i = 0; i < PACK_EGG_CAP; i++) {
      expect(takeEggIntoPack(gs, "mossback", child(), false)).toBeTruthy();
    }
    expect(takeEggIntoPack(gs, "mossback", child(), false)).toBeNull(); // pack full
    const first = gs.eggs![0];
    const hatchAt = first.hatchTick;
    const stored = nurseryStoreEgg(gs, first.id);
    expect(stored).toContain("warm nursery sand");
    expect(first.homestead).toBe(true);
    expect(nurseryEggs(gs)).toHaveLength(1);
    // the freed slot is real: a fifth egg fits
    expect(takeEggIntoPack(gs, "slimekin", child("slimekin"), false)).toBeTruthy();
    // and incubation never restarted: same hatch tick, ready when the clock says so
    gs.tick = hatchAt;
    expect(eggReady(gs, first)).toBe(true);
    const line = hatchCarriedEgg(gs, first.id, "keep");
    expect(line).not.toContain("no room");
    expect(gs.eggs!.find((e) => e.id === first.id)).toBeUndefined();
  });

  it("enforces rack capacity and take-back pack limits", () => {
    const gs = makeGs();
    readyNursery(gs);
    for (let i = 0; i < 3; i++) takeEggIntoPack(gs, "mossback", child(), false);
    const [a, b, c] = gs.eggs!;
    expect(nurseryStoreEgg(gs, a.id)).toContain("warm nursery sand");
    expect(nurseryStoreEgg(gs, b.id)).toContain("warm nursery sand");
    expect(nurseryStoreEgg(gs, c.id)).toContain("full"); // 2 slots
    expect(c.homestead).toBeFalsy();
    // the pack holds only c — taking one egg back succeeds, and a full pack refuses
    expect(nurseryTakeBackEgg(gs, a.id)).toContain("pack");
    expect(a.homestead).toBe(false);
    // fill the pack to its four-egg ceiling, then the racks refuse to give the egg back
    while (gs.eggs!.filter((e) => !e.homestead).length < PACK_EGG_CAP) takeEggIntoPack(gs, "slimekin", child("slimekin"), false);
    expect(nurseryTakeBackEgg(gs, b.id)).toContain("no room");
    expect(b.homestead).toBe(true);
  });

  it("refuse the nursery away from the homestead", () => {
    const gs = makeGs();
    readyNursery(gs);
    takeEggIntoPack(gs, "mossback", child(), false);
    gs.player.x = gs.homestead!.x + 40;
    expect(nurseryStoreEgg(gs, gs.eggs![0].id)).toContain("travel there and step inside");
  });
});

/* --------------------------------- migration --------------------------------- */

describe("homestead migration (v26 → v27)", () => {
  it("backfills nothing for saves that never bought land", () => {
    const gs = makeGs();
    const saved = JSON.parse(JSON.stringify({ ...gs, version: 26 })) as GameState;
    delete saved.homestead;
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.version).toBe(SAVE_VERSION);
    expect(saved.homestead).toBeUndefined();
  });

  it("preserves an owned homestead and repairs torn ledgers", () => {
    const gs = makeGs();
    buyAtHamlet(gs);
    gs.homestead!.facilities.pens = { level: 1 };
    gs.homestead!.storage.berries = 5;
    const saved = JSON.parse(JSON.stringify({ ...gs, version: 26 })) as GameState;
    (saved.homestead!.facilities.pens as { building?: number }).building = undefined as never;
    expect(migrateLoaded(saved)).toBe(true);
    expect(saved.version).toBe(SAVE_VERSION);
    expect(saved.homestead!.facilities.pens.level).toBe(1);
    expect(saved.homestead!.facilities.pens.building).toBeUndefined();
    expect(saved.homestead!.storage.berries).toBe(5);
    // idempotent: re-running the pipeline changes nothing
    expect(migrateLoaded(saved)).toBe(true);
  });

  it("drops a deed without geography rather than half-loading it", () => {
    const gs = makeGs();
    buyAtHamlet(gs);
    const saved = JSON.parse(JSON.stringify(gs)) as GameState;
    (saved.homestead as { x?: number }).x = undefined;
    migrateHomestead(saved);
    expect(saved.homestead).toBeUndefined();
  });
});
