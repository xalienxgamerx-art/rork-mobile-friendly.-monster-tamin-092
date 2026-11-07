import { DAY_TICKS } from "../src/game/data";
import { newGame, previewStarter } from "../src/game/sim";
import { isSettlement, settlementId } from "../src/game/settlement";
import { proclaimTournament, advanceTournaments, tourneysOf } from "../src/game/tournaments";
import { getWorld, seedFromText } from "../src/game/world";
const seed = "EXPEDITION-1";
const gs = newGame(seed, "Rook", "ranger", "#e8742a", previewStarter(seed, "mossback"));
const world = getWorld(seedFromText(seed));
const towns = world.allFeatures().filter((f) => isSettlement(f));
const tamers = Object.values(gs.tamers ?? {});
console.log("tamers:", tamers.length, "sample:", tamers.slice(0, 3).map((t) => ({ id: t.id, x: t.x, y: t.y, gold: t.gold, team: t.team?.length, recover: t.recoverUntil })));
const town = towns[0];
(gs.economy ??= {} as any)[settlementId(town)] = { food: 30, materials: 30, wares: 30, treasury: 900, day: 0 };
const tour = proclaimTournament(gs, town, 0);
console.log("tour", tour?.id, tour?.openDay, "fee", tour?.entryFee);
for (let d = 0; d < 8; d++) {
  gs.tick = (d + 1) * DAY_TICKS;
  advanceTournaments(gs);
  const t2 = tourneysOf(gs).active.find((x) => x.id === tour!.id);
  console.log("day", d + 1, t2 ? `${t2.phase} entrants=${t2.entrants.length}` : "gone");
  if (!t2) break;
}
