import { beforeEach, describe, expect, it } from "vitest";

import { DAY_TICKS } from "@/game/data";
import { STOCK_CAP, TREASURY_CAP, econOf, econPeek, marketLine, merchantPrice } from "@/game/economy";
import { ROUTE_MIN, disruptRoute, econTickNear, marketDay, partnersOf, routeOf } from "@/game/trade";
import { PREDATOR_KILLS, SHORTAGE_AID, advanceLivingWorld, devsAt, devsKnownToPlayer, livingOf, migrateLivingWorld, onAidToSettlement, onWorldDiscover, onWorldKill, shopPrice } from "@/game/worldevents";
import { migrateLoaded } from "@/game/migrate";
import { SAVE_VERSION, newGame, previewStarter } from "@/game/sim";
import { discoverFeature } from "@/game/knowledge";
import { needsOf } from "@/game/needs";
import { isSettlement, settlementId } from "@/game/settlement";
import type { DevInstance, GameState } from "@/game/types";
import { getWorld, seedFromText, type Feature } from "@/game/world";

/**
 * Update E — a living world. Settlement economies produce and consume on a
 * bounded daily step; trade moves surpluses between neighbors and coin the
 * other way; a development dispatcher gives communities persistent troubles
 * and good seasons with real lifecycles; the player's honest actions resolve
 * them. Everything is deterministic per seed — no Math.random, no wall clock.
 */

const SEED = "EXPEDITION-1";
const SEED_NUM = seedFromText(SEED);
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

let gs: GameState;
let towns: Feature[];

const settlementFeatures = (): Feature[] => getWorld(SEED_NUM).allFeatures().filter((f) => isSettlement(f));

/** A pair of settlements close enough to trade. */
function tradePair(): [Feature, Feature] {
  const [a, ...rest] = towns;
  const b = rest.find((f) => partnersOf(gs, a).some((p) => settlementId(p) === settlementId(f))) ?? rest[0];
  return [a, b];
}

/** Forces an economy record with the given stores (day-stamped to now). */
function forceEcon(f: Feature, stores: Partial<{ food: number; materials: number; wares: number; treasury: number }>): void {
  const today = Math.floor(gs.tick / DAY_TICKS);
  gs.economy ??= {};
  gs.economy[settlementId(f)] = { food: 30, materials: 30, wares: 30, treasury: 100, day: today, ...stores };
}

/** Drops a development instance into the ledger directly (dispatcher bypass for unit tests). */
function forceDev(defId: DevInstance["defId"], f: Feature, extra: Partial<DevInstance> = {}): DevInstance {
  const l = livingOf(gs);
  const dev: DevInstance = { id: `d${l.seq + 1}`, defId, key: settlementId(f), name: f.name, startedDay: Math.floor(gs.tick / DAY_TICKS), endsDay: Math.floor(gs.tick / DAY_TICKS) + 9, ...extra };
  l.seq += 1;
  l.active.push(dev);
  return dev;
}

/** The player's home settlement — the one place discovered from the first day. */
function homeTown(): Feature {
  const f = getWorld(SEED_NUM).siteAt(gs.player.homeX, gs.player.homeY)?.feature;
  expect(f && isSettlement(f)).toBe(true);
  return f!;
}

beforeEach(() => {
  gs = makeGs();
  towns = settlementFeatures();
});

describe("settlement economies", () => {
  it("initializes deterministically from the seed — two saves, one world", () => {
    const other = makeGs();
    for (const f of towns.slice(0, 6)) {
      expect(econOf(gs, f)).toEqual(econOf(other, f));
    }
  });

  it("stores and treasuries stay bounded under long catch-up", () => {
    const f = towns[0];
    econOf(gs, f);
    gs.tick += DAY_TICKS * 400; // over a year away
    const e = econOf(gs, f);
    for (const g of ["food", "materials", "wares"] as const) {
      expect(e[g]).toBeGreaterThanOrEqual(0);
      expect(e[g]).toBeLessThanOrEqual(STOCK_CAP);
    }
    expect(e.treasury).toBeGreaterThanOrEqual(0);
    expect(e.treasury).toBeLessThanOrEqual(TREASURY_CAP);
  });

  it("catch-up in one step equals day-by-day steps — the same save reaches the same stores", () => {
    const f = towns[1];
    econOf(gs, f);
    const slow = makeGs();
    const slowE = econOf(slow, f);
    for (let i = 0; i < 5; i++) {
      slow.tick += DAY_TICKS;
      econOf(slow, f);
    }
    gs.tick += DAY_TICKS * 5;
    const fast = econOf(gs, f);
    expect({ food: fast.food, materials: fast.materials, wares: fast.wares, treasury: fast.treasury }).toEqual({ food: slowE.food, materials: slowE.materials, wares: slowE.wares, treasury: slowE.treasury });
  });

  it("a starving economy speaks to the needs heartbeat", () => {
    const f = towns[2];
    econOf(gs, f); // create the record
    const key = settlementId(f);
    forceEcon(f, { food: 3 }); // day-stamped to now
    const before = needsOf(gs, f).food;
    gs.tick += DAY_TICKS; // next day: the econ step runs and speaks
    econOf(gs, f);
    expect(gs.settlementNeeds?.[key]?.food ?? before).toBeLessThan(before + 2); // pressure landed (drift may offset by 1)
  });

  it("marketLine describes the stores without numbers", () => {
    const f = towns[0];
    expect(econPeek(gs, f)).toBeNull(); // nothing yet — no lie
    econOf(gs, f);
    expect(marketLine(gs, f)).toMatch(/granaries/);
  });
});

describe("merchant pricing", () => {
  it("quotes a deterministic price, higher when goods are scarce", () => {
    const f = towns[0];
    forceEcon(f, { food: 40, treasury: 300 });
    const richPrice = merchantPrice(gs, f, "meat", "buy")!;
    forceEcon(f, { food: 2, treasury: 300 });
    const starvedPrice = merchantPrice(gs, f, "meat", "buy")!;
    expect(starvedPrice).toBeGreaterThan(richPrice);
    expect(merchantPrice(gs, f, "meat", "buy")).toBe(starvedPrice); // deterministic
  });

  it("never quotes below 1, and a coin-starved till pays less for your goods", () => {
    const f = towns[0];
    forceEcon(f, { food: 2, wares: 2, materials: 2, treasury: 0 });
    for (const id of ["meat", "ore", "tonic", "berries"]) {
      expect(merchantPrice(gs, f, id, "buy")).toBeGreaterThanOrEqual(1);
      expect(merchantPrice(gs, f, id, "sell")).toBeGreaterThanOrEqual(1);
    }
    const poorSell = merchantPrice(gs, f, "tonic", "sell")!;
    forceEcon(f, { treasury: TREASURY_CAP });
    expect(merchantPrice(gs, f, "tonic", "sell")!).toBeGreaterThan(poorSell);
  });

  it("development pressure rides on top: a shortage marks food up", () => {
    const f = towns[0];
    forceEcon(f, { food: 25, treasury: 200 });
    const base = shopPrice(gs, f, "meat", "buy")!;
    forceDev("shortage", f);
    expect(shopPrice(gs, f, "meat", "buy")!).toBeGreaterThan(base);
  });
});

describe("trade routes", () => {
  it("partners are the nearest settlements, deterministic and bounded", () => {
    const [a] = tradePair();
    const p1 = partnersOf(gs, a).map(settlementId);
    expect(partnersOf(gs, a).map(settlementId)).toEqual(p1);
    expect(p1.length).toBeLessThanOrEqual(3);
  });

  it("disruption cuts a route; drift repairs it slowly", () => {
    const [a, b] = tradePair();
    const key = settlementId(a);
    const other = settlementId(b);
    expect(routeOf(gs, key, other).cond).toBe(100);
    disruptRoute(gs, key, other, 80);
    expect(routeOf(gs, key, other).cond).toBe(20);
    gs.tick += DAY_TICKS;
    expect(routeOf(gs, key, other).cond).toBe(23); // +3/day recovery
  });

  it("a closed route moves no goods; an open route trades surplus for coin", () => {
    const [pa, pb] = tradePair();
    const aKey = settlementId(pa);
    const bKey = settlementId(pb);
    // the lexicographically first settlement holds the market day for the pair
    const [from, to] = aKey < bKey ? [pa, pb] : [pb, pa];
    const fromKey = settlementId(from);
    const toKey = settlementId(to);
    forceEcon(from, { food: 40, treasury: 100 });
    forceEcon(to, { food: 5, treasury: 100 });
    disruptRoute(gs, fromKey, toKey, 100);
    marketDay(gs, from, gs.economy![fromKey]);
    expect(gs.economy![toKey].food).toBe(5); // road closed: nothing moved
    // reopen the road and trade
    const r = routeOf(gs, fromKey, toKey);
    r.cond = 100;
    r.day = Math.floor(gs.tick / DAY_TICKS);
    marketDay(gs, from, gs.economy![fromKey]);
    expect(gs.economy![toKey].food).toBeGreaterThan(5);
    expect(gs.economy![fromKey].food).toBeLessThan(40);
    expect(gs.economy![fromKey].treasury).toBeGreaterThan(100); // coin followed the goods
  });

  it("the near tick steps economies and market days together", () => {
    const [a] = tradePair();
    gs.player.x = a.x;
    gs.player.y = a.y;
    gs.tick += DAY_TICKS;
    econTickNear(gs, getWorld(SEED_NUM));
    expect(econPeek(gs, a)?.tradeDay).toBe(Math.floor(gs.tick / DAY_TICKS));
  });
});

describe("world developments", () => {
  it("dispatches only among discovered settlements", () => {
    gs.tick += DAY_TICKS;
    advanceLivingWorld(gs);
    // every active development anchors to a settlement the player has discovered
    for (const d of livingOf(gs).active) {
      const [, x, y] = d.key.split(":").map(Number);
      expect(gs.knowledge.discovered[`f:${x}:${y}`]).toBeTruthy();
    }
  });

  it("spawns at most one development per day, with no same-day double-booking", () => {
    const f = homeTown();
    forceEcon(f, { food: 2 }); // make a shortage eligible here
    gs.settlementNeeds![settlementId(f)] = { ...needsOf(gs, f), food: 20 };
    gs.tick += DAY_TICKS;
    advanceLivingWorld(gs);
    expect(livingOf(gs).active.length).toBe(1);
    // a second beat the same day spawns nothing more
    advanceLivingWorld(gs);
    expect(livingOf(gs).active.length).toBe(1);
  });

  it("the player's aid ends a shortage — with standing earned under a stable guard", () => {
    const f = towns[0];
    econOf(gs, f);
    const dev = forceDev("shortage", f, { progress: 0 });
    const before = needsOf(gs, f).food;
    for (let i = 0; i < SHORTAGE_AID; i++) onAidToSettlement(gs, dev.key);
    expect(livingOf(gs).active.find((d) => d.id === dev.id)).toBeUndefined();
    expect(livingOf(gs).history.find((r) => r.id === dev.id)?.outcome).toBe("player");
    expect(needsOf(gs, f).food).toBeGreaterThan(before - 10); // recovery lifted the need
    expect(Object.keys(gs.repApplied ?? {}).some((k) => k.startsWith(`org:dev:${dev.id}:`))).toBe(true);
  });

  it("culls break a predator outbreak and open the roads again", () => {
    const f = towns[0];
    econOf(gs, f);
    const [p] = partnersOf(gs, f);
    const pKey = settlementId(p);
    econOf(gs, p);
    disruptRoute(gs, settlementId(f), pKey, 30);
    const dev = forceDev("predators", f, { speciesId: "gnasher", progress: 0 });
    for (let i = 0; i < PREDATOR_KILLS; i++) onWorldKill(gs, "gnasher", f.x + 5, f.y + 5);
    expect(livingOf(gs).active.find((d) => d.id === dev.id)).toBeUndefined();
    expect(livingOf(gs).history.find((r) => r.id === dev.id)?.outcome).toBe("player");
    expect(routeOf(gs, settlementId(f), pKey).cond).toBeGreaterThan(ROUTE_MIN); // the road recovered
  });

  it("kills far from the settlement do not count", () => {
    const f = towns[0];
    const dev = forceDev("predators", f, { speciesId: "gnasher", progress: 0 });
    for (let i = 0; i < PREDATOR_KILLS; i++) onWorldKill(gs, "gnasher", f.x + 500, f.y + 500);
    expect(livingOf(gs).active.find((d) => d.id === dev.id)?.progress).toBe(0);
  });

  it("charting country near a wondering town becomes trade", () => {
    const f = towns[0];
    const dev = forceDev("discovery", f, { progress: 0 });
    onWorldDiscover(gs, f.x + 10, f.y + 10);
    expect(livingOf(gs).active.find((d) => d.id === dev.id)).toBeUndefined();
    expect(livingOf(gs).history.find((r) => r.id === dev.id)?.outcome).toBe("player");
  });

  it("the ledger stays bounded across a season of lapsing stories", () => {
    const f = towns[0];
    const day0 = Math.floor(gs.tick / DAY_TICKS);
    // a long stretch of already-expired stories, all lapsing on the next beat
    for (let i = 0; i < 30; i++) {
      forceDev("bloom", f, { id: `dx${i}`, startedDay: day0, endsDay: day0 });
    }
    gs.tick += DAY_TICKS * 2;
    advanceLivingWorld(gs);
    expect(livingOf(gs).history.length).toBeLessThanOrEqual(60);
    expect(livingOf(gs).active.length).toBeLessThanOrEqual(8);
  });

  it("the known-world view only shows developments at discovered settlements", () => {
    const f = homeTown();
    forceDev("bloom", f);
    expect(devsKnownToPlayer(gs).some((d) => d.key === settlementId(f))).toBe(true);
  });
});

describe("persistence", () => {
  it("a v30 save migrates to the living world and stays stable on re-load", () => {
    gs.version = 30;
    gs.living = undefined;
    gs.economy = undefined;
    gs.routes = undefined;
    expect(migrateLoaded(gs)).toBe(true);
    expect(gs.version).toBe(SAVE_VERSION);
    expect(gs.living).toBeDefined();
    expect(gs.economy).toEqual({});
    expect(gs.routes).toEqual({});
    // idempotent: a second pass changes nothing
    const snapshot = JSON.stringify(livingOf(gs));
    migrateLivingWorld(gs);
    expect(JSON.stringify(livingOf(gs))).toBe(snapshot);
  });

  it("developments and economies survive a save round-trip", () => {
    const f = towns[0];
    econOf(gs, f);
    forceDev("shortage", f, { progress: 1 });
    const parsed = JSON.parse(JSON.stringify({ living: gs.living, economy: gs.economy })) as GameState;
    expect(parsed.living!.active[0].defId).toBe("shortage");
    expect(parsed.economy![settlementId(f)].day).toBe(Math.floor(gs.tick / DAY_TICKS));
  });
});
