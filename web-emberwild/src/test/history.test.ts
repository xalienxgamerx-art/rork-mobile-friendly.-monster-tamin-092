import { describe, expect, it } from "vitest";

import { DAY_TICKS, SPECIES } from "@/game/data";
import { historyOf, chronicleEntries, figureOf, livingFigures, loreForFigure, readFigure } from "@/game/history";
import { migrateLoaded } from "@/game/migrate";
import { SAVE_VERSION, newGame, previewStarter } from "@/game/sim";
import { isSettlement, settlementId } from "@/game/settlement";
import { advanceTournaments, proclaimTournament, tourneysOf } from "@/game/tournaments";
import type { GameState } from "@/game/types";
import { getWorld, seedFromText, type Feature } from "@/game/world";

/**
 * Update G.1 — the generational past. Every world is born with ~50 notable
 * historical tamers whose careers ran through the real engines before the
 * player arrived. The past must be deterministic per seed, strictly separate
 * from the living world, and bounded — these tests pin all three.
 */

const SEED = "EXPEDITION-1";
const SEED_NUM = seedFromText(SEED);
const makeGs = (seed = SEED): GameState => newGame(seed, "Rook", "ranger", "#e8742a", previewStarter(seed, "mossback"));

const towns = (): Feature[] => getWorld(SEED_NUM).allFeatures().filter((f) => isSettlement(f));

describe("history: deterministic generation", () => {
  it("identical seeds raise identical pasts", () => {
    const a = makeGs();
    const b = makeGs();
    expect(JSON.stringify(a.history)).toBe(JSON.stringify(b.history));
  });

  it("different seeds raise different pasts", () => {
    const a = makeGs();
    const b = makeGs("DIFFERENT-WORLD-9");
    expect(JSON.stringify(a.history)).not.toBe(JSON.stringify(b.history));
  });

  it("historyOf is idempotent — a second call returns the same records untouched", () => {
    const gs = makeGs();
    const before = JSON.stringify(gs.history);
    const h = historyOf(gs);
    expect(JSON.stringify(gs.history)).toBe(before);
    expect(h).toBe(gs.history);
  });

  it("an old save without history regenerates the identical past from its seed", () => {
    const a = makeGs();
    const b = makeGs();
    b.history = undefined;
    expect(migrateLoaded(b)).toBe(true);
    expect(JSON.stringify(b.history)).toBe(JSON.stringify(a.history));
  });
});

describe("history: the generational population", () => {
  it("about fifty figures across three generations, ids in the h:g register", () => {
    const gs = makeGs();
    const h = gs.history!;
    expect(h.figures.length).toBeGreaterThanOrEqual(48);
    expect(h.figures.length).toBeLessThanOrEqual(52);
    for (const f of h.figures) {
      expect(f.id).toMatch(/^h:g\d+$/);
      expect(f.generation).toBeGreaterThanOrEqual(1);
      expect(f.generation).toBeLessThanOrEqual(3);
      expect(["champion", "explorer", "scholar", "official"]).toContain(f.profession);
      expect(["living", "retired", "deceased", "missing"]).toContain(f.status);
      expect(["notable", "ordinary"]).toContain(f.notability);
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.bio.length).toBeGreaterThan(0);
    }
  });

  it("lives vary — not everyone triumphed, and not everyone is gone", () => {
    const gs = makeGs();
    const statuses = new Set(gs.history!.figures.map((f) => f.status));
    expect(statuses.size).toBeGreaterThanOrEqual(2);
  });

  it("historical tamers never enter the PAT loop", () => {
    const gs = makeGs();
    // PAT ids live in gs.tamers; the past lives in gs.history — no crossover
    for (const id of Object.keys(gs.tamers ?? {})) {
      expect(figureOf(gs, id)).toBeNull();
      expect(id.startsWith("h:")).toBe(false);
    }
    for (const f of gs.history!.figures) {
      expect(gs.tamers?.[f.id]).toBeUndefined();
    }
  });

  it("signature beasts are real species; famous lines use the real lineage system", () => {
    const gs = makeGs();
    for (const f of gs.history!.figures) {
      for (const m of f.team) {
        expect(SPECIES[m.speciesId]).toBeDefined();
        expect(m.level).toBeGreaterThanOrEqual(3);
        if (m.lineageId !== null) {
          expect(m.lineageId).toMatch(/^L:h/);
          expect(gs.lineages?.[m.lineageId]).toBeDefined();
        }
      }
    }
    // at least one famous bloodline was recorded, and it points back at its founder
    const lines = Object.entries(gs.lineages ?? {}).filter(([id]) => id.startsWith("L:h"));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const [lid, rec] of lines) {
      const founder = figureOf(gs, lid.slice(2));
      expect(founder).not.toBeNull();
      expect(rec.speciesId).toBe(founder!.team[0].speciesId);
      expect(rec.historical).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("history: the event archive", () => {
  it("events are strictly day-ordered, negative, and every reference resolves", () => {
    const gs = makeGs();
    const h = gs.history!;
    expect(h.events.length).toBeGreaterThan(0);
    for (let i = 0; i < h.events.length; i++) {
      const ev = h.events[i];
      expect(ev.id).toMatch(/^he\d+$/);
      expect(ev.day).toBeLessThan(0);
      if (i > 0) expect(ev.day).toBeGreaterThanOrEqual(h.events[i - 1].day);
      for (const fid of ev.figureIds) expect(figureOf(gs, fid)).not.toBeNull();
      for (const rid of ev.refs) expect(h.events.some((e) => e.id === rid)).toBe(true);
      if (ev.tourId !== undefined) expect(ev.tourId.startsWith("H:")).toBe(true);
    }
  });

  it("the circuit predates the player: historical finals sit in the tournament ledger", () => {
    const gs = makeGs();
    const hist = gs.tournaments?.history.filter((x) => x.day < 0) ?? [];
    expect(hist.length).toBeGreaterThan(0);
    // and they are real bracket outcomes, not flavor: champion, runner-up, field
    for (const h of hist) {
      expect(h.championName.length).toBeGreaterThan(0);
      expect(h.runnerUpName.length).toBeGreaterThan(0);
      expect(h.entrants).toBeGreaterThanOrEqual(2);
    }
  });

  it("living champions fill future fields through the standard path; the retired never register again", () => {
    const gs = makeGs();
    const today = Math.floor(gs.tick / DAY_TICKS);
    // a host with a real treasury, so the proclamation can afford its purse
    const town = towns()[0];
    gs.economy ??= {};
    gs.economy[settlementId(town)] = { food: 30, materials: 30, wares: 30, treasury: 800, day: today };
    const tour = proclaimTournament(gs, town, today);
    expect(tour).not.toBeNull();
    if (!tour) return;
    // the circuit draws from tamers within its region — gather a thin field so
    // registration holds and the historical fill runs
    for (const t of Object.values(gs.tamers ?? {}).slice(0, 3)) {
      t.x = town.x + 2;
      t.y = town.y + 2;
      t.gold = Math.max(t.gold, 60);
    }
    for (let d = today; d <= tour.openDay + 4; d++) {
      gs.tick = (d + 1) * DAY_TICKS;
      advanceTournaments(gs);
      if (tourneysOf(gs).active.some((x) => x.id === tour.id && x.phase === "underway")) break;
    }
    advanceTournaments(gs);
    // the event may be underway or already in the ledger — its field is what counts
    const field = tourneysOf(gs).active.find((t) => t.id === tour.id)?.entrants ?? [];
    const entrants = field.length ? field : [];
    const fin = gs.tournaments?.history.find((h) => h.id === tour.id);
    expect(entrants.length > 0 || fin).toBe(true);
    const ids = new Set(entrants.map((e) => e.id));
    for (const e of entrants) {
      if (e.kind === "historical" && e.id.startsWith("h:g")) {
        const fig = figureOf(gs, e.id);
        expect(fig).not.toBeNull();
        expect(fig!.status).toBe("living");
        expect(fig!.profession).toBe("champion");
      }
    }
    // retired / deceased / missing figures never appear — records, not lives
    for (const f of gs.history!.figures) {
      if (f.status !== "living") expect(ids.has(f.id)).toBe(false);
    }
  });
});

describe("history: lore and chronicles", () => {
  it("lore is bounded, attributed, and provenance-honest", () => {
    const gs = makeGs();
    const h = gs.history!;
    expect(h.lore.length).toBeGreaterThan(0);
    expect(h.lore.length).toBeLessThanOrEqual(64);
    for (const l of h.lore) {
      expect(l.id).toMatch(/^lr\d+$/);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.text.length).toBeGreaterThan(0);
      expect(l.source.length).toBeGreaterThan(0);
      expect(["record", "hearsay"]).toContain(l.reliability);
      if (l.figureId !== undefined) expect(figureOf(gs, l.figureId)).not.toBeNull();
      if (l.eventId !== undefined) expect(h.events.some((e) => e.id === l.eventId)).toBe(true);
    }
    // disputed flags only ride on hearsay
    for (const l of h.lore) if (l.disputed) expect(l.reliability).toBe("hearsay");
  });

  it("hearsay exaggerates a record that also exists — the truth stays findable", () => {
    const gs = makeGs();
    const h = gs.history!;
    const disputed = h.lore.filter((l) => l.disputed && l.eventId !== undefined);
    for (const d of disputed) {
      expect(h.lore.some((l) => l.reliability === "record" && l.eventId === d.eventId)).toBe(true);
    }
  });

  it("the discovery gate: nothing is read until the player reads it", () => {
    const gs = makeGs();
    expect(chronicleEntries(gs).found.length).toBe(0);
    expect(chronicleEntries(gs).locked).toBe(gs.history!.lore.length);
    // read one figure's tale
    const fig = gs.history!.figures.find((f) => loreForFigure(gs, f.id).length > 0);
    expect(fig).toBeDefined();
    if (!fig) return;
    const added = readFigure(gs, fig.id);
    expect(added).toBe(loreForFigure(gs, fig.id).length);
    const { found, locked } = chronicleEntries(gs);
    expect(found.length).toBe(added);
    expect(locked).toBe(gs.history!.lore.length - added);
    // reading twice adds nothing
    expect(readFigure(gs, fig.id)).toBe(0);
  });
});

describe("history: settlement culture and presence", () => {
  it("settlements with a past have traditions keyed to their settlement id", () => {
    const gs = makeGs();
    const h = gs.history!;
    const keys = Object.keys(h.cultures);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toMatch(/^s:-?\d+:-?\d+$/);
      expect(h.cultures[k].tradition.length).toBeGreaterThan(0);
      expect(h.cultures[k].text.length).toBeGreaterThan(0);
    }
  });

  it("living figures stand at their posts in their home settlements", () => {
    const gs = makeGs();
    const world = getWorld(SEED_NUM);
    const living = livingFigures(gs);
    expect(living.length).toBeGreaterThan(0);
    let placed = 0;
    for (const f of towns()) {
      const key = settlementId(f);
      const home = living.filter((g) => g.homeKey === key);
      if (!home.length) continue;
      const npcs = world.settlementFigures(f, gs.history);
      for (const g of home) expect(npcs.some((n) => n.figureId === g.id)).toBe(true);
      placed += home.length;
    }
    expect(placed).toBe(living.length);
  });

  it("the missing are remembered at wild landmarks", () => {
    const gs = makeGs();
    const world = getWorld(SEED_NUM);
    const missing = gs.history!.figures.filter((f) => f.status === "missing");
    for (const g of missing) {
      expect(g.lastX).toBeDefined();
      expect(g.lastY).toBeDefined();
      // the waystone sits at their last-known landmark (nudged off the tile)
      const f = world.siteAt(g.lastX!, g.lastY!)?.feature;
      if (f) expect(["ruin", "shrine"]).toContain(f.kind);
    }
  });
});

describe("history: persistence", () => {
  it("a current save round-trips through migrateLoaded with its past intact", () => {
    const gs = makeGs();
    const json = JSON.stringify(gs);
    const parsed = JSON.parse(json) as GameState;
    expect(migrateLoaded(parsed)).toBe(true);
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(JSON.stringify(parsed.history)).toBe(JSON.stringify(gs.history));
  });

  it("migration is idempotent — loading twice changes nothing", () => {
    const parsed = JSON.parse(JSON.stringify(makeGs())) as GameState;
    expect(migrateLoaded(parsed)).toBe(true);
    const snap = JSON.stringify(parsed.history);
    expect(migrateLoaded(parsed)).toBe(true);
    expect(JSON.stringify(parsed.history)).toBe(snap);
  });
});
