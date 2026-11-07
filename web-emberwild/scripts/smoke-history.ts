/**
 * Headless smoke for the generational past (Update G.1): boots fresh worlds
 * from a few seeds, times generation, and reports the archive's shape and
 * size. Run with: bun scripts/smoke-history.ts
 */
import { DAY_TICKS } from "../src/game/data";
import { chronicleEntries, historyStateSize, livingFigures, readFigure } from "../src/game/history";
import { migrateLoaded } from "../src/game/migrate";
import { newGame, previewStarter } from "../src/game/sim";
import { isSettlement, settlementId, settlementTier } from "../src/game/settlement";
import { advanceTournaments, proclaimTournament } from "../src/game/tournaments";
import type { GameState } from "../src/game/types";
import { getWorld, seedFromText } from "../src/game/world";

const SEEDS = ["EXPEDITION-1", "EMBERWILD", "SEASON-OF-ASH"];

for (const seed of SEEDS) {
  const t0 = performance.now();
  const gs: GameState = newGame(seed, "Rook", "ranger", "#e8742a", previewStarter(seed, "mossback"));
  const genMs = (performance.now() - t0).toFixed(0);
  const h = gs.history!;
  const statuses = new Map<string, number>();
  const profs = new Map<string, number>();
  for (const f of h.figures) {
    statuses.set(f.status, (statuses.get(f.status) ?? 0) + 1);
    profs.set(f.profession, (profs.get(f.profession) ?? 0) + 1);
  }
  const fmt = (m: Map<string, number>) => [...m.entries()].map(([k, v]) => `${k}:${v}`).join(" ");
  const histFinals = (gs.tournaments?.history ?? []).filter((x) => x.day < 0).length;
  const bytes = JSON.stringify(gs).length;

  // one live proclamation near the tamers, to show living champions can still enter
  const world = getWorld(seedFromText(seed));
  const tamers = Object.values(gs.tamers ?? {});
  const near = (f: { x: number; y: number }) => Math.min(...tamers.map((t) => Math.max(Math.abs(t.x - f.x), Math.abs(t.y - f.y))));
  const towns = world
    .allFeatures()
    .filter((f) => isSettlement(f))
    .sort((a, b) => near(a) - near(b));
  const today = Math.floor(gs.tick / DAY_TICKS);
  gs.economy ??= {};
  let liveField = "called off — too few names";
  for (const town of towns.slice(0, 4)) {
    gs.tournaments!.active = gs.tournaments!.active.filter((x) => x.phase !== "registration");
    // the circuit draws from tamers within its region — gather a thin field so
    // the old generations walk in under MIN_FIELD
    for (const t of Object.values(gs.tamers ?? {}).slice(0, 3)) {
      t.x = town.x + 2;
      t.y = town.y + 2;
      t.gold = Math.max(t.gold, 60);
    }
    gs.economy[settlementId(town)] = { food: 30, materials: 30, wares: 30, treasury: 900, day: today };
    const tour = proclaimTournament(gs, town, today);
    if (!tour) continue;
    for (let d = today; d <= tour.openDay + 4; d++) {
      gs.tick = (d + 1) * DAY_TICKS;
      advanceTournaments(gs);
      if (gs.tournaments?.active.some((x) => x.id === tour.id && x.phase === "underway")) break;
    }
    const t2 = gs.tournaments?.active.find((x) => x.id === tour.id);
    const fin = gs.tournaments?.history.find((x) => x.id === tour.id);
    if (!t2 && !fin) continue;
    const hist = (t2?.entrants ?? []).filter((e) => e.kind === "historical" && e.id.startsWith("h:g")).length;
    liveField = fin
      ? `final on day ${fin.day}: ${fin.championName} took it over ${fin.runnerUpName}, ${fin.entrants} entrants`
      : t2
        ? `${t2.phase} with ${t2.entrants.length} entrants (${hist} from the old generations)`
        : "called off — too few names";
    break;
  }

  // migration replay (before the chronicle read touches the discovery gate)
  const parsed = JSON.parse(JSON.stringify(gs)) as GameState;
  parsed.history = undefined;
  migrateLoaded(parsed);
  const replayExact = JSON.stringify(parsed.history) === JSON.stringify(h);

  // chronicle gate
  const fig = h.figures.find((f) => h.lore.some((l) => l.figureId === f.id));
  const read = fig ? readFigure(gs, fig.id) : 0;

  console.log(`seed ${seed}: gen ${genMs}ms · ${h.figures.length} figures (${fmt(profs)}) · statuses ${fmt(statuses)}`);
  console.log(`  archive: ${h.events.length} events, ${h.lore.length} lore, ${Object.keys(h.cultures).length} cultures, ${histFinals} historical finals, ${livingFigures(gs).length} living placed`);
  console.log(`  state size ${(bytes / 1024).toFixed(0)}kB (history ${(JSON.stringify(h).length / 1024).toFixed(0)}kB) · chronicles: ${read} read of ${chronicleEntries(gs).locked + read} · replay exact: ${replayExact}`);
  console.log(`  live circuit: ${liveField}`);
}
