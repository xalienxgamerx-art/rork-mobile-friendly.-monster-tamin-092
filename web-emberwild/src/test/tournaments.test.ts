import { beforeEach, describe, expect, it } from "vitest";

import { DAY_TICKS } from "@/game/data";
import { econOf, econPeek } from "@/game/economy";
import { migrateLoaded } from "@/game/migrate";
import { SAVE_VERSION, newGame, previewStarter } from "@/game/sim";
import { discoverFeature } from "@/game/knowledge";
import { isSettlement, settlementId } from "@/game/settlement";
import {
  FORMATS,
  advanceTournaments,
  fightPlayerMatch,
  migrateTournaments,
  playerMatch,
  proclaimTournament,
  rankings,
  registerPlayer,
  tierOf,
  tournamentsTick,
  venueName,
} from "@/game/tournaments";
import type { GameState, Tournament } from "@/game/types";
import { getWorld, seedFromText, type Feature } from "@/game/world";

/**
 * Update F — the tournament circuit. Hosting is funded by real settlement
 * treasuries; the lifecycle is registration → underway → completed →
 * history; brackets are deterministic Grand Melees with byes; NPC matches
 * resolve through the shared headless combat rules; the player fights live
 * through the real engine; prizes pay exactly once; the F–S rating table is
 * shared by everyone. No Math.random, no wall clock.
 */

const SEED = "EXPEDITION-1";
const SEED_NUM = seedFromText(SEED);
const makeGs = (): GameState => newGame(SEED, "Rook", "ranger", "#e8742a", previewStarter(SEED, "mossback"));

let gs: GameState;

/** Towns and cities of this world (the hosting tiers). */
function bigTowns(): Feature[] {
  return getWorld(SEED_NUM)
    .allFeatures()
    .filter((f) => isSettlement(f) && (f.kind === "town" || f.kind === "city"));
}

const dayOf = (g: GameState): number => Math.floor(g.tick / DAY_TICKS);
const nextDay = (g: GameState): void => {
  g.tick = (dayOf(g) + 1) * DAY_TICKS;
};

/** Places the player inside a settlement tile so settlementHere works. */
function standIn(g: GameState, f: Feature): void {
  g.player.x = f.x;
  g.player.y = f.y;
}

/** Proclaims a tournament at the first big town and returns it. */
function forceTournament(g: GameState = gs, day = dayOf(g)): Tournament {
  const town = bigTowns()[0];
  discoverFeature(g, town, false);
  const t = proclaimTournament(g, town, day);
  expect(t).not.toBeNull();
  return t as Tournament;
}

/** Weighs in one historical name directly (records only) so a bracket can form. */
function padOne(g: GameState, tour: Tournament): void {
  const n = tour.entrants.length;
  tour.entrants.push({ id: `h:test${n}`, kind: "historical", name: `Old Hand ${n}`, team: [{ speciesId: "mossback", level: 5, name: "mossback" }], feePaid: 0 });
}

beforeEach(() => {
  gs = makeGs();
});

describe("foundations", () => {
  it("backfills empty circuit ledgers on migration, idempotently", () => {
    const gs2 = JSON.parse(JSON.stringify(makeGs())) as GameState;
    gs2.tournaments = undefined;
    gs2.version = 31;
    expect(migrateLoaded(gs2)).toBe(true);
    expect(gs2.version).toBe(SAVE_VERSION);
    expect(gs2.tournaments).toBeDefined();
    expect(gs2.tournaments!.active).toEqual([]);
    expect(gs2.tournaments!.history).toEqual([]);
    expect(gs2.tournaments!.paid).toEqual({});
    const before = JSON.stringify(gs2.tournaments);
    migrateTournaments(gs2);
    expect(JSON.stringify(gs2.tournaments)).toBe(before);
  });

  it("hosting escrows the purse out of the host's own treasury", () => {
    const town = bigTowns()[0];
    discoverFeature(gs, town, false);
    econOf(gs, town); // materialize the host's till
    const today = econPeek(gs, town)?.treasury ?? 0;
    expect(today).toBeGreaterThan(0);
    const before = econPeek(gs, town)!.treasury;
    const tour = proclaimTournament(gs, town, dayOf(gs))!;
    expect(tour.purse).toBeGreaterThan(0);
    expect(econPeek(gs, town)!.treasury).toBe(before - tour.purse);
  });

  it("only towns and cities ever host", () => {
    const town = bigTowns()[0];
    expect(["town", "city"]).toContain(town.kind);
    const tour = proclaimTournament(gs, town, dayOf(gs))!;
    expect(tour.hostKey).toBe(settlementId(town));
    expect(tour.phase).toBe("registration");
  });

  it("a broke host promises nothing", () => {
    const town = bigTowns()[0];
    econOf(gs, town).treasury = 0;
    expect(proclaimTournament(gs, town, dayOf(gs))).toBeNull();
  });

  it("format registry keeps the Grand Melee the only playable format", () => {
    expect(FORMATS.grand_melee.playable).toBe(true);
    for (const f of Object.values(FORMATS)) if (f.id !== "grand_melee") expect(f.playable).toBe(false);
  });
});

describe("registration", () => {
  it("a failed registration consumes nothing", () => {
    const tour = forceTournament();
    const gold = gs.player.gold;
    // far from the host: refusal, no fee taken
    expect(registerPlayer(gs, tour.id)).toMatch(/stand in the host/);
    expect(gs.player.gold).toBe(gold);
    expect(tour.entrants).toHaveLength(0);
  });

  it("the player enters in person: fee paid once, team weighed in as-is", () => {
    const tour = forceTournament();
    standIn(gs, getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!);
    const gold = gs.player.gold;
    expect(registerPlayer(gs, tour.id)).toBeNull();
    expect(gs.player.gold).toBe(gold - tour.entryFee);
    expect(tour.entrants).toHaveLength(1);
    expect(tour.entrants[0]).toMatchObject({ id: "player", kind: "player", feePaid: tour.entryFee });
    expect(tour.purse).toBeGreaterThan(tour.purse - tour.entryFee);
    const purseAfterFirst = tour.purse;
    expect(registerPlayer(gs, tour.id)).toMatch(/Already entered/);
    expect(tour.purse).toBe(purseAfterFirst);
    expect(gs.player.gold).toBe(gold - tour.entryFee);
  });

  it("eligibility gates keep unsuitable teams out without taking coin", () => {
    const tour = forceTournament();
    tour.maxLevel = 2; // a novice bracket
    standIn(gs, getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!);
    const gold = gs.player.gold;
    expect(registerPlayer(gs, tour.id)).toMatch(/lesser teams/);
    expect(gs.player.gold).toBe(gold);
  });

  it("a called-off event refunds every fee and the escrow", () => {
    econOf(gs, bigTowns()[0]); // materialize the till before the escrow lands
    const before = econPeek(gs, bigTowns()[0])!.treasury;
    const tour = forceTournament();
    const town = getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!;
    standIn(gs, town);
    const gold = gs.player.gold;
    registerPlayer(gs, tour.id);
    tour.openDay = dayOf(gs); // registration closes tonight
    advanceTournaments(gs);
    // the player alone is not a field: fees home, escrow home (any new event
    // proclaimed elsewhere keeps its own purse out of this town's till)
    expect(gs.player.gold).toBe(gold);
    const escrowed = gs.tournaments!.active.reduce((s, x) => s + (x.hostKey === tour.hostKey ? x.purse : 0), 0);
    expect(econPeek(gs, town)!.treasury).toBe(before - escrowed);
    expect(gs.tournaments!.active.some((x) => x.id === tour.id)).toBe(false);
  });
});

describe("brackets", () => {
  it("build exactly once, deterministically, with byes for a non-power-of-two field", () => {
    const mk = (): { g: GameState; tour: Tournament } => {
      const g = makeGs();
      const tour = forceTournament(g);
      standIn(g, getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!);
      registerPlayer(g, tour.id);
      padOne(g, tour);
      tour.openDay = dayOf(g);
      advanceTournaments(g); // closes registration, pads historicals, builds bracket
      return { g, tour };
    };
    const a = mk();
    const b = mk();
    expect(a.tour.rounds.length).toBe(b.tour.rounds.length);
    expect(a.tour.rounds.flat().map((m) => [m.a, m.b])).toEqual(b.tour.rounds.flat().map((m) => [m.a, m.b]));
    expect(a.tour.phase).toBe("underway");
    // byes: a non-power-of-two field leaves empty slots in round 0
    const ids = a.tour.entrants.length;
    if (ids !== 0 && (ids & (ids - 1)) !== 0) {
      expect(a.tour.rounds[0].some((m) => m.a === null || m.b === null)).toBe(true);
    }
    // every entrant appears exactly once in round 0
    const flat = a.tour.rounds[0].flatMap((m) => [m.a, m.b]).filter(Boolean);
    expect(flat).toHaveLength(a.tour.entrants.length);
  });

  it("rival tamers enter on their own judgment, within the region, deterministically", () => {
    const tour = forceTournament();
    const tamers = Object.values(gs.tamers!);
    // bring one rival inside the region with a full purse
    const t1 = tamers[0];
    t1.x = tour.fx + 2;
    t1.y = tour.fy + 2;
    t1.gold = 500;
    t1.recoverUntil = 0;
    t1.tourney = null;
    advanceTournaments(gs);
    const entered = tour.entrants.some((e) => e.id === t1.id);
    // deterministic: the same state always answers the same way
    const gs2 = makeGs();
    const tour2 = (() => {
      discoverFeature(gs2, getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!, false);
      return proclaimTournament(gs2, getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!, dayOf(gs))!;
    })();
    const t1b = Object.values(gs2.tamers!).find((t) => t.id === t1.id)!;
    t1b.x = tour.fx + 2;
    t1b.y = tour.fy + 2;
    t1b.gold = 500;
    t1b.recoverUntil = 0;
    advanceTournaments(gs2);
    expect(tour2.entrants.some((e) => e.id === t1.id)).toBe(entered);
  });
});

describe("resolution", () => {
  it("an all-NPC bracket resolves headlessly, one round a day, and pays the champion exactly once", () => {
    const town = bigTowns()[0];
    discoverFeature(gs, town, false);
    const tour = proclaimTournament(gs, town, dayOf(gs))!;
    padOne(gs, tour);
    padOne(gs, tour);
    tour.openDay = dayOf(gs);
    advanceTournaments(gs); // close + bracket + round 0
    expect(tour.phase).toBe("underway");
    const rounds = tour.rounds.length;
    for (let d = 0; d < rounds + 1; d++) {
      nextDay(gs);
      advanceTournaments(gs);
    }
    expect(tour.phase === "completed" || !gs.tournaments!.active.some((x) => x.id === tour.id)).toBe(true);
    // the champion's record is in the circuit's history exactly once
    const h = gs.tournaments!.history.filter((x) => x.id === tour.id);
    expect(h).toHaveLength(1);
    expect(h[0].championId).toBeTruthy();
    expect(h[0].championId).not.toBe(h[0].runnerUpName);
    // ratings moved: the champion has at least one win on the ladder
    const champ = gs.tournaments!.ratings[h[0].championId];
    expect(champ.wins).toBeGreaterThanOrEqual(1);
    expect(champ.titles).toBe(1);
    // the purse left the system exactly once: paid guards recorded
    expect(Object.keys(gs.tournaments!.paid).length).toBeGreaterThanOrEqual(1);
  });

  it("duplicate resolution is a no-op the same day", () => {
    const tour = forceTournament();
    padOne(gs, tour);
    padOne(gs, tour); // an all-NPC field
    tour.openDay = dayOf(gs);
    advanceTournaments(gs); // build day
    advanceTournaments(gs); // round 0 resolves
    const after1 = tour.rounds.flat().map((m) => [m.id, m.winner, m.resolvedDay] as const);
    expect(after1.some(([, w]) => w)).toBe(true);
    advanceTournaments(gs); // same day again: settled matches never change their mind
    for (const [id, w, d] of after1) {
      const m = tour.rounds.flat().find((x) => x.id === id)!;
      if (!w) continue; // still-open matches may take their turn on this beat
      expect(m.winner).toBe(w);
      expect(m.resolvedDay).toBe(d);
    }
  });

  it("the F–S tiers read as a ladder and default at par", () => {
    expect(tierOf(1000)).toBe("F");
    expect(tierOf(1200)).toBe("D");
    expect(tierOf(1600)).toBe("S");
    // the circuit predates the player (Update G.1): the ladder is already
    // populated by the old generations' careers
    const rows = rankings(gs);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.id.startsWith("h:"))).toBe(true);
  });
});

describe("the player's live matches", () => {
  it("the opponent steps onto the sand as an instanced body and the real engine engages", () => {
    const tour = forceTournament();
    standIn(gs, getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!);
    registerPlayer(gs, tour.id);
    padOne(gs, tour);
    tour.openDay = dayOf(gs);
    advanceTournaments(gs);
    const pm = playerMatch(gs);
    expect(pm).not.toBeNull();
    const err = fightPlayerMatch(gs);
    expect(err).toBeNull();
    const pending = gs.tournaments!.pending!;
    expect(pending.creatureId.startsWith("tour:")).toBe(true);
    expect(gs.creatures[pending.creatureId]).toBeDefined();
    expect(gs.target).toBe(pending.creatureId);
    // winning: the opponent yields — no purse, no carrion, no world hooks
    delete gs.creatures[pending.creatureId];
    delete gs.fighters[pending.creatureId];
    const mine = gs.tournaments!.active.find((t) => t.id === tour.id)!;
    tournamentsTick(gs);
    expect(mine.rounds.flat().find((m) => m.id === pending.matchId)!.winner).toBe("player");
  });

  it("a fainted team forfeits the match", () => {
    const tour = forceTournament();
    standIn(gs, getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!);
    registerPlayer(gs, tour.id);
    padOne(gs, tour);
    tour.openDay = dayOf(gs);
    advanceTournaments(gs);
    expect(fightPlayerMatch(gs)).toBeNull();
    for (const m of gs.party) m.hp = 0;
    tournamentsTick(gs);
    const mine = gs.tournaments!.active.find((t) => t.id === tour.id)!;
    const match = mine.rounds.flat().find((m) => m.a === "player" || m.b === "player")!;
    expect(match.winner).not.toBe("player");
    expect(gs.creatures[gs.tournaments!.pending?.creatureId ?? "x"]).toBeUndefined();
  });

  it("an absent player forfeits the round and the bracket moves on", () => {
    const tour = forceTournament();
    standIn(gs, getWorld(SEED_NUM).tile(tour.fx, tour.fy).feature!);
    registerPlayer(gs, tour.id);
    padOne(gs, tour);
    tour.openDay = dayOf(gs);
    advanceTournaments(gs);
    nextDay(gs);
    nextDay(gs); // the round day passes, then the forfeit beats
    advanceTournaments(gs);
    const match = tour.rounds.flat().find((m) => m.a === "player" || m.b === "player")!;
    expect(match.winner).not.toBe("player");
  });

  it("champion's prizes land in the player's hand exactly once", () => {
    const town = bigTowns()[0];
    discoverFeature(gs, town, false);
    const tour = proclaimTournament(gs, town, dayOf(gs))!;
    standIn(gs, town);
    const goldBefore = gs.player.gold;
    registerPlayer(gs, tour.id);
    padOne(gs, tour);
    tour.openDay = dayOf(gs);
    advanceTournaments(gs); // close + bracket (historicals pad the field)
    winOut(gs, tour);
    const hist = gs.tournaments!.history.find((h) => h.id === tour.id);
    expect(hist).toBeDefined();
    expect(hist!.championId).toBe("player");
    // the champion's purse: entry fee back plus the winner's share
    expect(gs.player.gold).toBeGreaterThan(goldBefore - tour.entryFee);
  });
});

describe("venues", () => {
  it("names the coliseum where one stands, and falls back gracefully", () => {
    const town = bigTowns()[0];
    expect(venueName(gs, town)).toMatch(/Coliseum|chapter|hall|inn yard/);
  });
});

/** Fights — and wins — every live match on the player's road to the title. */
function winOut(g: GameState, tour: Tournament): void {
  for (let d = 0; d < 8 && !g.tournaments!.history.some((h) => h.id === tour.id); d++) {
    if (!g.tournaments!.pending && playerMatch(g)) {
      expect(fightPlayerMatch(g)).toBeNull();
      const pending = g.tournaments!.pending!;
      delete g.creatures[pending.creatureId];
      delete g.fighters[pending.creatureId];
      tournamentsTick(g);
    }
    nextDay(g);
    advanceTournaments(g);
  }
  expect(g.tournaments!.history.some((h) => h.id === tour.id)).toBe(true);
}
