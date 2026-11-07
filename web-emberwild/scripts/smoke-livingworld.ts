// One-off living-world smoke: boots a new game headlessly, advances days so a
// development can spawn, and probes the shop + notices UI. PNGs to /tmp/dumps.
import { chromium } from "playwright-core";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await page.goto("http://localhost:5199", { waitUntil: "load" });
await page.waitForTimeout(2500);

// Probe the game modules directly: simulate the sim-level loop headlessly.
const report = await page.evaluate(async () => {
  const sim = await import("/src/game/sim.ts");
  const worldMod = await import("/src/game/world.ts");
  const we = await import("/src/game/worldevents.ts");
  const eco = await import("/src/game/economy.ts");
  const trade = await import("/src/game/trade.ts");

  const gs = sim.newGame("EXPEDITION-1", "Rook", "ranger", "#e8742a", sim.previewStarter("EXPEDITION-1", "mossback"));
  const world = worldMod.getWorld(gs.seed);
  const towns = world.allFeatures().filter((f: { kind: string }) => f.kind === "hamlet" || f.kind === "town" || f.kind === "city");
  const home = world.siteAt(gs.player.homeX, gs.player.homeY)?.feature;

  // discover a handful of settlements, drain the home granary, and run 12 days
  for (const t of towns.slice(0, 8)) worldMod.discoverFeature ? null : null;
  const knowledge = await import("/src/game/knowledge.ts");
  for (const t of towns.slice(0, 8)) knowledge.discoverFeature(gs, t, false);
  const key = `s:${home.x}:${home.y}`;
  eco.econOf(gs, home);
  gs.economy[key].food = 2;
  for (let d = 0; d < 12; d++) {
    gs.tick += 288;
    we.advanceLivingWorld(gs);
    trade.econTickNear(gs, world);
  }
  const active = (gs.living?.active ?? []).map((d: { defId: string; name: string }) => `${d.defId}@${d.name}`);
  const known = we.devsKnownToPlayer(gs).length;
  const price = home ? we.shopPrice(gs, home, "meat", "buy") : null;
  const line = home ? eco.marketLine(gs, home) : null;
  const routes = Object.keys(gs.routes ?? {}).length;
  return { towns: towns.length, active, known, price, line, routes, history: gs.living?.history.length ?? 0 };
});

console.log(JSON.stringify(report, null, 1));
await page.screenshot({ path: "/tmp/dumps/livingworld-title.png" });
await browser.close();
if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  process.exit(1);
}
