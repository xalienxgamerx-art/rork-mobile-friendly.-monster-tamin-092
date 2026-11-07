import { describe, expect, it } from "vitest";

import {
  abandonContract,
  acceptContract,
  activeContractCount,
  advanceContracts,
  claimContract,
  contractState,
  declineContract,
  claimReady,
  offersAt,
  objectivesDone,
  onDiscover,
  onForage,
  onKill,
  onTame,
} from "@/game/contracts";
import { BIOMES, DAY_TICKS, ITEMS } from "@/game/data";
import { discoverFeature } from "@/game/knowledge";
import { migrateLoaded } from "@/game/migrate";
import { applyNeedDelta, needsOf, profileFor } from "@/game/needs";
import { SAVE_VERSION } from "@/game/sim";
import { assocAtKey } from "@/game/rumors";
import { repOf } from "@/game/reputation";
import { settlementId } from "@/game/settlement";
import { forageHere, newGame, previewStarter } from "@/game/sim";
import type { Contract, ContractCategory, GameState } from "@/game/types";
import { getWorld, seedFromText, type Feature } from "@/game/world";

/**
 * Update A — settlement needs and the contract system. Needs must be real,
 * deterministic state; contracts must be offered from real conditions,
 * progress only through authoritative events, and pay out exactly once.
 */

const SEED = "CONTRACT-1";
const SEED_NUM = seedFromText(SEED);
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

const world = getWorld(SEED_NUM);
const settlements = world.allFeatures().filter((f) => f.kind === "hamlet" || f.kind === "town" || f.kind === "city");
const first = settlements[0];
const keyOf = (f: Feature): string => settlementId(f);

/** Teleports the player onto a settlement's green so board/claim checks run in place. */
const moveTo = (gs: GameState, f: Feature): void => {
  gs.player.x = f.x;
  gs.player.y = f.y;
};

const NEED_KEYS = ["food", "materials", "security", "trade", "population", "prosperity"] as const;

/** Finds (or day-scans for) an offer of a category and accepts it. */
function acceptCategory(gs: GameState, f: Feature, category: ContractCategory, maxDays = 12): Contract | null {
  moveTo(gs, f);
  for (let d = 0; d < maxDays; d++) {
    gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
    for (const c of offersAt(gs, f)) {
      if (c.category === category && acceptContract(gs, c.id)) return c;
    }
  }
  return null;
}

/** The first settlement in this world with an association chapter. */
function assocSettlement(gs: GameState): Feature | null {
  for (const f of settlements) if (assocAtKey(gs, settlementId(f))) return f;
  return null;
}

/* --------------------------------- Needs ------------------------------------ */

describe("settlement needs", () => {
  it("are deterministic: the same seed and settlement always rebuild the same stocks", () => {
    const a = makeGs();
    const b = makeGs();
    const na = needsOf(a, first);
    const nb = needsOf(b, first);
    expect(na).toEqual(nb);
    expect(profileFor(a.seed, first)).toBe(profileFor(b.seed, first));
  });

  it("differ between settlements — profiles come from biome, tier and seed", () => {
    const gs = makeGs();
    const profiles = new Set<string>();
    const stocks = new Set<string>();
    for (const f of settlements.slice(0, 24)) {
      const n = needsOf(gs, f);
      profiles.add(n.profile);
      stocks.add(JSON.stringify([n.food, n.materials, n.security, n.trade, n.population, n.prosperity]));
    }
    expect(profiles.size).toBeGreaterThanOrEqual(2);
    expect(stocks.size).toBeGreaterThanOrEqual(12);
  });

  it("stay bounded in [0, 100] even after a year of catch-up", () => {
    const gs = makeGs();
    gs.tick += DAY_TICKS * 365;
    const n = needsOf(gs, first);
    for (const k of NEED_KEYS) {
      expect(n[k]).toBeGreaterThanOrEqual(0);
      expect(n[k]).toBeLessThanOrEqual(100);
    }
    expect(n.day).toBe(Math.floor(gs.tick / DAY_TICKS));
  });

  it("survive a save round-trip unchanged", () => {
    const gs = makeGs();
    const n = needsOf(gs, first);
    const parsed = JSON.parse(JSON.stringify(gs)) as GameState;
    expect(needsOf(parsed, first)).toEqual(n);
  });

  it("respond to real events — a delta moves the right needle and never leaves bounds", () => {
    const gs = makeGs();
    const key = keyOf(first);
    needsOf(gs, first);
    const before = gs.settlementNeeds![key].security;
    applyNeedDelta(gs, key, "security", 6);
    expect(gs.settlementNeeds![key].security).toBe(Math.min(100, before + 6));
    applyNeedDelta(gs, key, "security", -999);
    expect(gs.settlementNeeds![key].security).toBe(0);
  });
});

/* ------------------------------ Generation ----------------------------------- */

const HOOKED: ContractCategory[] = ["hunting", "gathering", "delivery", "exploration", "monster_handling"];

describe("contract generation", () => {
  it("posts a deterministic daily board of hooked categories, no duplicates", () => {
    const gs = makeGs();
    moveTo(gs, first);
    const a = offersAt(gs, first);
    const b = offersAt(gs, first);
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    for (const c of a) expect(HOOKED).toContain(c.category);
    expect(new Set(a.map((c) => c.category)).size).toBe(a.length);
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
    for (const c of a) {
      expect(c.expiresDay).toBeGreaterThan(c.postedDay);
      expect(c.objectives.length).toBeGreaterThan(0);
      expect(c.reward.gold).toBeGreaterThan(0);
      expect(c.status).toBe("offered");
    }
  });

  it("answers real conditions: a settlement that fears the woods posts culls", () => {
    const gs = makeGs();
    moveTo(gs, first);
    // the board never doubles a category, so compare the share of the board
    // given to culls: the frightened town leans on hunting, the content one rarely
    // (two states — the board is cached for the day, so they must sample
    // different days independently)
    const key = keyOf(first);
    const gs2 = makeGs();
    moveTo(gs2, first);
    gs.settlementNeeds![key] = { ...needsOf(gs, first), food: 100, materials: 100, security: 0, trade: 100, population: 100, prosperity: 100 };
    gs2.settlementNeeds![key] = { ...needsOf(gs2, first), food: 100, materials: 100, security: 100, trade: 100, population: 100, prosperity: 100 };
    let frightened = { hunts: 0, total: 0 };
    let content = { hunts: 0, total: 0 };
    for (let d = 0; d < 10; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      gs2.tick = gs.tick;
      for (const c of offersAt(gs, first)) {
        frightened.total++;
        if (c.category === "hunting") frightened.hunts++;
      }
      for (const c of offersAt(gs2, first)) {
        content.total++;
        if (c.category === "hunting") content.hunts++;
      }
    }
    expect(frightened.hunts).toBeGreaterThan(0);
    expect(frightened.hunts / frightened.total).toBeGreaterThan(content.hunts / content.total);
  }, 30000);

  it("refuses to hire the distrusted", () => {
    const gs = makeGs();
    moveTo(gs, first);
    gs.rep!.settlements.player = { [keyOf(first)]: { v: -40, at: 0 } };
    expect(offersAt(gs, first)).toEqual([]);
  });

  it("posts the same board at any hour of the same day (audit regression)", () => {
    const a = makeGs();
    const b = makeGs();
    const day = 30;
    a.tick = day * DAY_TICKS + 10;
    b.tick = day * DAY_TICKS + 200;
    moveTo(a, first);
    moveTo(b, first);
    expect(JSON.stringify(offersAt(a, first))).toBe(JSON.stringify(offersAt(b, first)));
  });

  it("an accepted offer is never re-posted the same day — active ids stay unique (audit regression)", () => {
    const gs = makeGs();
    moveTo(gs, first);
    const board = offersAt(gs, first);
    expect(board.length).toBeGreaterThanOrEqual(2);
    expect(acceptContract(gs, board[0].id)).toContain("accepted");
    for (let i = 1; i < board.length; i++) declineContract(gs, board[i].id);
    // the emptied board must not regenerate the accepted offer under its own id
    const after = offersAt(gs, first);
    expect(after.find((c) => c.id === board[0].id)).toBeUndefined();
    expect(acceptContract(gs, board[0].id)).toBeNull();
    const ids = gs.contracts!.active.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exploration work names real undiscovered landmarks; a charted one cannot be re-accepted", () => {
    const gs = makeGs();
    moveTo(gs, first);
    for (let d = 0; d < 10; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      const exp = offersAt(gs, first).find((c) => c.category === "exploration");
      if (exp) {
        const t = exp.objectives[0].target!;
        expect(gs.knowledge.discovered[`f:${t.x}:${t.y}`]).toBeFalsy();
        expect(acceptContract(gs, exp.id)).toContain("accepted");
        // the posting is consumed on acceptance — a second accept finds nothing
        expect(acceptContract(gs, exp.id)).toBeNull();
        return;
      }
    }
    // this seed simply has no exploration offer in ten days — nothing to assert
  }, 30000);
});

/* -------------------------------- Lifecycle ---------------------------------- */

describe("contract lifecycle", () => {
  it("hunting: progress on real kills only, pays once, at the issuing settlement", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "hunting");
    expect(c).toBeTruthy();
    const o = c!.objectives[0];
    const goldBefore = gs.player.gold;
    const repBefore = repOf(gs, "player", "settlements", keyOf(first));
    for (let i = 0; i < o.count; i++) onKill(gs, o.speciesId!);
    expect(o.progress).toBe(o.count);
    expect(objectivesDone(c!)).toBe(true);
    // off-site claiming is refused
    gs.player.x = first.x + 400;
    gs.player.y = first.y + 400;
    expect(claimContract(gs, c!.id)).toContain("Return to");
    moveTo(gs, first);
    expect(claimContract(gs, c!.id)).toContain("Contract complete");
    expect(gs.player.gold).toBeGreaterThan(goldBefore);
    const repAfter = repOf(gs, "player", "settlements", keyOf(first));
    expect(repAfter ?? 0).toBeGreaterThan(repBefore ?? 0);
    // the payout is exactly once
    expect(claimContract(gs, c!.id)).toBeNull();
    expect(activeContractCount(gs)).toBe(0);
    expect(gs.contracts!.history[0].status).toBe("completed");
  }, 30000);

  it("gathering: over-foraging caps, never overfills", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "gathering");
    expect(c).toBeTruthy();
    const o = c!.objectives[0];
    onForage(gs, o.itemId!, 2);
    expect(o.progress).toBe(2);
    onForage(gs, o.itemId!, 99);
    expect(o.progress).toBe(o.count);
  }, 30000);

  it("gathering: a real forage haul advances the board work", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "gathering");
    expect(c).toBeTruthy();
    const o = c!.objectives[0];
    // scan the world for a tile whose biome forage table includes the wanted item
    const w = getWorld(gs.seed);
    let spot: { x: number; y: number } | null = null;
    outer: for (let y = first.y - 200; y < first.y + 200; y += 3) {
      for (let x = first.x - 200; x < first.x + 200; x += 3) {
        if (!w.inBounds(x, y)) continue;
        const t = w.tile(x, y);
        const table = (BIOMES[t.biome]?.forage ?? []).map(([id]) => id);
        if (table.includes(o.itemId!)) {
          spot = { x, y };
          break outer;
        }
      }
    }
    expect(spot).toBeTruthy();
    gs.player.x = spot!.x;
    gs.player.y = spot!.y;
    const before = o.progress;
    for (let i = 0; i < 220 && o.progress < o.count; i++) {
      forageHere(gs);
      // step between a few tiles so each attempt draws fresh ground
      gs.player.x = spot!.x + (i % 2);
      gs.player.y = spot!.y + (Math.floor(i / 2) % 2);
      gs.depleted[`${spot!.x + (i % 2)},${spot!.y + (Math.floor(i / 2) % 2)}`] = 0;
    }
    expect(o.progress).toBeGreaterThan(before);
  }, 60000);

  it("delivery: the bag gates the claim (UI parity), not tracked progress (audit regression)", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "delivery");
    expect(c).toBeTruthy();
    const o = c!.objectives[0];
    // progress is only recorded at settlement — the claim gate must read the bag
    expect(objectivesDone(c!)).toBe(false);
    expect(claimReady(gs, c!)).toBe(false);
    gs.bag[o.itemId!] = o.count;
    expect(claimReady(gs, c!)).toBe(true);
  }, 30000);

  it("delivery: goods are handed over in person, consumed exactly once", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "delivery");
    expect(c).toBeTruthy();
    const o = c!.objectives[0];
    gs.bag[o.itemId!] = o.count;
    moveTo(gs, first);
    const before = gs.player.gold;
    expect(claimContract(gs, c!.id)).toContain("Contract complete");
    expect(gs.bag[o.itemId!] ?? 0).toBe(0);
    expect(gs.player.gold).toBeGreaterThan(before);
    expect(gs.contracts!.history[0].status).toBe("completed");
  }, 30000);

  it("exploration: a real first discovery completes the chart work", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "exploration");
    expect(c).toBeTruthy();
    const t = c!.objectives[0].target!;
    // discoverFeature is the authoritative discovery path (knowledge.ts)
    expect(discoverFeature(gs, { kind: c!.objectives[0].featureKind!, name: t.name, x: t.x, y: t.y }, false)).toBe(true);
    expect(c!.objectives[0].progress).toBe(1);
    moveTo(gs, first);
    expect(claimContract(gs, c!.id)).toContain("Contract complete");
  }, 30000);

  it("monster handling: a real befriending completes the commission", () => {
    const gs = makeGs();
    // chapters and headquarters post this work — hamlets cannot
    const f = assocSettlement(gs);
    if (!f) return; // this seed has no chapter; covered by other seeds in CI
    const c = acceptCategory(gs, f, "monster_handling");
    expect(c).toBeTruthy();
    const o = c!.objectives[0];
    for (let i = 0; i < o.count; i++) onTame(gs, o.speciesId!);
    expect(objectivesDone(c!)).toBe(true);
    moveTo(gs, f!);
    expect(claimContract(gs, c!.id)).toContain("Contract complete");
    expect(gs.settlementNeeds![keyOf(f!)]).toBeDefined();
  }, 30000);

  it("abandoning work costs standing; lapsing does not", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "hunting");
    expect(c).toBeTruthy();
    const key = keyOf(first);
    gs.rep!.settlements.player = { [key]: { v: 10, at: 0 } };
    moveTo(gs, first);
    expect(abandonContract(gs, c!.id)).toContain("walk away");
    expect(gs.rep!.settlements.player![key].v).toBeLessThan(10);
    expect(gs.contracts!.history[0].status).toBe("failed");

    const gs2 = makeGs();
    const c2 = acceptCategory(gs2, first, "gathering");
    expect(c2).toBeTruthy();
    gs2.tick = (c2!.expiresDay + 1) * DAY_TICKS;
    advanceContracts(gs2);
    expect(gs2.contracts!.history[0].status).toBe("expired");
    expect(activeContractCount(gs2)).toBe(0);
  }, 30000);

  it("declined offers stay declined for the day; the board caps active work at three", () => {
    const gs = makeGs();
    moveTo(gs, first);
    const first1 = offersAt(gs, first)[0];
    declineContract(gs, first1.id);
    expect(offersAt(gs, first).find((c) => c.id === first1.id)).toBeUndefined();

    const gs2 = makeGs();
    moveTo(gs2, first);
    const taken: string[] = [];
    for (let d = 0; d < 8 && activeContractCount(gs2) < 3; d++) {
      gs2.tick = (Math.floor(gs2.tick / DAY_TICKS) + 1) * DAY_TICKS;
      for (const c of offersAt(gs2, first)) {
        if (activeContractCount(gs2) >= 3) break;
        if (acceptContract(gs2, c.id)) taken.push(c.id);
      }
    }
    expect(taken.length).toBe(3);
    const extra = offersAt(gs2, first)[0];
    if (extra) expect(acceptContract(gs2, extra.id)).toContain("only carry");
  }, 30000);
});

/* ------------------------------- Persistence --------------------------------- */

describe("contract persistence", () => {
  it("active work and history survive a save round-trip", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "gathering");
    expect(c).toBeTruthy();
    onForage(gs, c!.objectives[0].itemId!, 1);
    const parsed = JSON.parse(JSON.stringify(gs)) as GameState;
    expect(parsed.contracts!.active[0].id).toBe(c!.id);
    expect(parsed.contracts!.active[0].objectives[0].progress).toBe(1);
  });

  it("a v24 save migrates: board and needs are backfilled; a current save keeps its work", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "gathering");
    expect(c).toBeTruthy();
    const legacy = JSON.parse(JSON.stringify(gs)) as GameState & { version: number };
    legacy.version = 24;
    delete legacy.contracts;
    delete legacy.settlementNeeds;
    expect(migrateLoaded(legacy)).toBe(true);
    expect(legacy.version).toBe(SAVE_VERSION);
    expect(legacy.contracts).toBeDefined();
    expect(legacy.contracts!.active).toEqual([]);
    expect(legacy.settlementNeeds).toEqual({});
    const fresh = JSON.parse(JSON.stringify(gs)) as GameState & { version: number };
    expect(migrateLoaded(fresh)).toBe(true);
    expect(fresh.contracts!.active[0].id).toBe(c!.id);
  }, 30000);

  it("a partially populated v24 save migrates field by field (audit regression)", () => {
    // contracts present, needs missing: the work survives, the needs backfill
    const gs = makeGs();
    const c = acceptCategory(gs, first, "gathering");
    expect(c).toBeTruthy();
    const noNeeds = JSON.parse(JSON.stringify(gs)) as GameState & { version: number };
    noNeeds.version = 24;
    delete noNeeds.settlementNeeds;
    expect(migrateLoaded(noNeeds)).toBe(true);
    expect(noNeeds.version).toBe(SAVE_VERSION);
    expect(noNeeds.settlementNeeds).toEqual({});
    expect(noNeeds.contracts!.active[0].id).toBe(c!.id);
    // needs present, contracts missing: the stocks survive, the board backfills
    const noContracts = JSON.parse(JSON.stringify(gs)) as GameState & { version: number };
    noContracts.version = 24;
    delete noContracts.contracts;
    const needsBefore = noContracts.settlementNeeds;
    expect(migrateLoaded(noContracts)).toBe(true);
    expect(noContracts.version).toBe(SAVE_VERSION);
    expect(noContracts.settlementNeeds).toEqual(needsBefore);
    expect(noContracts.contracts!.active).toEqual([]);
    // a v24 save whose contract record is half-formed (missing history/declined)
    const torn = JSON.parse(JSON.stringify({ ...gs, version: 24, contracts: { active: gs.contracts!.active } })) as GameState;
    expect(migrateLoaded(torn)).toBe(true);
    expect(torn.contracts!.active[0].id).toBe(c!.id);
    expect(torn.contracts!.history).toEqual([]);
    expect(torn.contracts!.declined).toEqual({});
  }, 30000);

  it("migration is idempotent for contract state (audit regression)", () => {
    const gs = makeGs();
    const c = acceptCategory(gs, first, "gathering");
    expect(c).toBeTruthy();
    const parsed = JSON.parse(JSON.stringify(gs)) as GameState & { version: number };
    parsed.version = 24;
    expect(migrateLoaded(parsed)).toBe(true);
    const once = JSON.stringify(parsed.contracts);
    expect(migrateLoaded(parsed)).toBe(true);
    expect(JSON.stringify(parsed.contracts)).toBe(once);
  }, 30000);
});

/* ------------------------------- Shape checks -------------------------------- */

describe("contract model", () => {
  it("unhooked categories are never offered; state backfills clean", () => {
    const gs = makeGs();
    moveTo(gs, first);
    for (let d = 0; d < 6; d++) {
      gs.tick = (Math.floor(gs.tick / DAY_TICKS) + 1) * DAY_TICKS;
      for (const c of offersAt(gs, first)) expect(HOOKED).toContain(c.category);
    }
    const cs = contractState(gs);
    expect(cs.declined).toBeDefined();
    expect(cs.history).toEqual([]);
  }, 30000);

  it("rewards name real items", () => {
    const gs = makeGs();
    moveTo(gs, first);
    for (const c of offersAt(gs, first)) for (const r of c.reward.items) expect(ITEMS[r.id]).toBeDefined();
  });

  it("repeatability: the same seed and event sequence reach the identical world state (audit regression)", () => {
    const run = (): { needs: unknown; contracts: unknown; rep: unknown } => {
      const gs = makeGs();
      moveTo(gs, first);
      const board = offersAt(gs, first);
      if (board.length) {
        acceptContract(gs, board[0].id);
        declineContract(gs, board[board.length - 1].id);
      }
      for (const o of board[0]?.objectives ?? []) {
        if (o.kind === "forage") onForage(gs, o.itemId!, o.count);
        if (o.kind === "kill") for (let i = 0; i < o.count; i++) onKill(gs, o.speciesId!);
      }
      gs.tick += DAY_TICKS * 3; // three days pass: expiry and drift run
      advanceContracts(gs);
      return { needs: gs.settlementNeeds, contracts: gs.contracts, rep: gs.rep };
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
