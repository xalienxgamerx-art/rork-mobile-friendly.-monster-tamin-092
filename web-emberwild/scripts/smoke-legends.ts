/**
 * Headless smoke for the legendary roster (Update G): boots fresh worlds from a
 * few seeds, verifies site placement, the full discovery ladder, encounter
 * spawning, a death-proof withdrawal, taming gates and the breeding guard —
 * plus a save/load round-trip. Run with: bun scripts/smoke-legends.ts
 */
import { DAY_TICKS } from "../src/game/data";
import { offspringSpecies } from "../src/game/breeding";
import { loreAt, readChronicles } from "../src/game/history";
import { legendList, legendSites, legendTameGate, legendTick, type LegendSite } from "../src/game/legends";
import { migrateLoaded } from "../src/game/migrate";
import { killWild, wildMonster, type Fighter } from "../src/game/combat";
import { newGame, previewStarter } from "../src/game/sim";
import type { GameState, WildCreature } from "../src/game/types";
import { getWorld, timeOf } from "../src/game/world";

const SEEDS = ["EMBERWILD", "legendList()-1", "SEASON-OF-ASH"];

let failures = 0;
const check = (ok: boolean, label: string): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok" : "FAIL"}  ${label}`);
};

for (const seedText of SEEDS) {
  console.log(`\n=== ${seedText} ===`);
  const t0 = performance.now();
  const gs: GameState = newGame(seedText, "Rook", "ranger", "#e8742a", previewStarter(seedText, "mossback"));
  const genMs = (performance.now() - t0).toFixed(0);
  const world = getWorld(gs.seed);
  const sites = legendSites(gs.seed);

  check(Object.keys(gs.legends ?? {}).length === legendList().length, "all ladder entries backfilled, all undiscovered");
  check(legendList().every((d) => gs.legends![d.speciesId].stage === "undiscovered"), "all stages start undiscovered");
  check(gs.history.lore.filter((l) => l.legendId).length === legendList().length, "all archive entries with provenance");
  check(legendList().every((d) => world.npcAt(sites[d.speciesId].ev.x, sites[d.speciesId].ev.y, gs.tick, gs.history)?.name.includes("legend-stone")), "legend-stones stand at every evidence site");

  const start = world.startPoint();
  check(legendList().every((d) => Math.hypot(sites[d.speciesId].x - start.x, sites[d.speciesId].y - start.y) > 100), "all territories far from the start");

  // full ladder for every legend: stone → evidence → territory → conditions → body
  for (const def of legendList()) {
    const site = sites[def.speciesId];
    readChronicles(gs, loreAt(gs, site.ev.x, site.ev.y));
    check(gs.legends![def.speciesId].stage === "rumored", `${def.speciesId}: rumor from the stone`);

    gs.player.x = site.ev.x;
    gs.player.y = site.ev.y;
    gs.player.layer = site.ev.layer;
    gs.tick += 4 - (gs.tick % 4) + 2;
    legendTick(gs, world);
    check(gs.legends![def.speciesId].stage === "evidence", `${def.speciesId}: evidence at the site`);

    gs.player.x = site.x;
    gs.player.y = site.y;
    gs.player.layer = site.layer;
    gs.tick += 4;
    legendTick(gs, world);
    check(gs.legends![def.speciesId].stage === "located", `${def.speciesId}: territory located`);

    // wait for the individual's own conditions (legendTick acts on tick % 4 === 2)
    let t = -1;
    for (let scan = gs.tick + ((2 - (gs.tick % 4) + 4) % 4 || 4); scan < gs.tick + 20_000; scan += 4) {
      if (def.encounter(world, site.x, site.y, scan)) {
        t = scan;
        break;
      }
    }
    check(t > 0, `${def.speciesId}: its conditions occur in time`);
    if (t < 0) continue;
    gs.tick = t;
    legendTick(gs, world);
    const body = gs.creatures[`leg:${def.speciesId}`];
    check(!!body, `${def.speciesId}: the individual materializes (Lv ${def.level})`);
    check(body?.level === def.level && Math.max(Math.abs(body!.x - site.x), Math.abs(body!.y - site.y)) <= 32, `${def.speciesId}: body at its territory, veteran level`);
    check(gs.legends![def.speciesId].stage === "available", `${def.speciesId}: stage available`);
  }

  // withdrawal: a legend at zero survives, goes home, cooldown armed
  {
    const def = legendList()[0];
    const body = gs.creatures[`leg:${def.speciesId}`];
    if (body) {
      const f: Fighter = { key: body.id, side: "wild", mon: wildMonster(gs, body), x: body.x, y: body.y, fp: 1, creatureId: body.id };
      killWild(gs, f);
      const after = gs.creatures[`leg:${def.speciesId}`];
      check(!!after && after.hpFrac === 0.6, `${def.speciesId}: withdrawn alive at 0.6 hpFrac`);
      check(after?.x === body.homeX && after?.y === body.homeY, `${def.speciesId}: back at its anchor`);
      check(gs.legends![def.speciesId].stage === "fought" && gs.legends![def.speciesId].calmUntil! > gs.tick, `${def.speciesId}: stage fought, cooldown armed`);
      // taming gate refuses while it is strong; consent logic per def elsewhere
      check(typeof legendTameGate(gs, after!) === "string" || after!.hpFrac <= 0.5, `${def.speciesId}: gate guards its terms`);
      // re-emergence after cooldown: the wanderer returns to the territory
      const site = site0(gs, def.speciesId);
      gs.player.x = site.x;
      gs.player.y = site.y;
      gs.player.layer = site.layer;
      gs.tick = gs.legends![def.speciesId].calmUntil! + 6;
      gs.tick = gs.tick - (gs.tick % 4) + 2;
      if (def.encounter(world, site.x, site.y, gs.tick)) {
        legendTick(gs, world);
        check(gs.legends![def.speciesId].stage === "available", `${def.speciesId}: re-staged available after cooldown`);
      }
    }
  }

  // breeding guard
  {
    const def = legendList()[0];
    const child = offspringSpecies({ speciesId: def.speciesId, level: def.level } as WildCreature, { speciesId: "mossback", level: 8 } as WildCreature);
    check(child === def.offspring, `breeding guard: ${def.speciesId} x mossback → ${child}`);
  }

  // save/load round-trip
  {
    const parsed = JSON.parse(JSON.stringify(gs)) as GameState;
    migrateLoaded(parsed);
    const bodies = legendList().map((d) => Object.keys(parsed.creatures).filter((id) => id === `leg:${d.speciesId}`).length);
    check(bodies.every((n) => n <= 1), "round-trip: no duplicate legendary bodies");
    check(Object.keys(parsed.legends ?? {}).length === legendList().length, "round-trip: ladder persisted");
  }

  const bytes = JSON.stringify(gs).length;
  console.log(`  generated in ${genMs} ms, save ${Math.round(bytes / 1024)} KB, day ${Math.floor(gs.tick / DAY_TICKS)} (${timeOf(gs.tick).label})`);
}

function site0(gs: GameState, speciesId: string): LegendSite {
  return legendSites(gs.seed)[speciesId];
}

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
