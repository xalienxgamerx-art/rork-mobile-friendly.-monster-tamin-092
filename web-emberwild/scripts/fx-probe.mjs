/**
 * FX visual probe: drives a new journey into the map, then injects cosmetic
 * events through the fx module (Vite serves the same module instance the app
 * uses) and screenshots each element's impact burst, area ring and projectile,
 * plus the siphon / shell / nova specials.
 *
 * Usage: bun scripts/fx-probe.mjs [baseURL]   (dev server on :5199)
 */
const { chromium } = await import(process.env.RORK_PLAYWRIGHT_MODULE ?? "/usr/local/lib/node_modules/playwright/index.mjs");
const base = process.argv[2] ?? "http://localhost:5199";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: "networkidle" });
await page.getByText("New Journey").click();
await page.waitForTimeout(600);
await page.keyboard.type("Ember");
await page.getByText("Choose a companion").click();
await page.waitForTimeout(600);
await page.locator("button:has(img)").first().click();
await page.getByRole("button", { name: /^Choose (?!a\b)/i }).click();
await page.waitForTimeout(3500); // world load + intro

const cam = await page.evaluate(async () => {
  const fx = await import("/src/game/fx.ts");
  return { ...fx.mapCamera };
});
console.log("camera:", JSON.stringify(cam));
if (!cam.w) {
  console.error("map camera not ready");
  await browser.close();
  process.exit(1);
}

const els = ["fire", "water", "earth", "air", "nature", "frost", "shadow", "neutral"];
for (const el of els) {
  await page.evaluate((el) => {
    return (async () => {
      const fx = await import("/src/game/fx.ts");
      const c = fx.mapCamera;
      const x = Math.round(c.cx);
      const y = Math.round(c.cy);
      const color = fx.elementColor(el);
      fx.pushBurst("burst", x + 1, y + 1, color, { el }); // single-target impact
      const tiles = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push([x - 4 + dx, y + dy]);
      fx.pushBurst("ring", x - 4, y, color, { tiles, el }); // area effect
      fx.pushProjectile(x - 4, y, x + 2, y + 1, color, el); // ranged shot, mid-flight
    })();
  }, el);
  await page.waitForTimeout(250);
  await page.screenshot({ path: "scripts/tamer-art/fx_" + el + ".png" });
  await page.waitForTimeout(900);
}

await page.evaluate(() => {
  return (async () => {
    const fx = await import("/src/game/fx.ts");
    const c = fx.mapCamera;
    const x = Math.round(c.cx);
    const y = Math.round(c.cy);
    fx.pushBurst("siphon", x, y, "#9a6fd0", { x1: x - 3, y1: y }); // drain stream
    fx.pushBurst("shell", x + 3, y, "#b08a4a"); // self-buff frame
    const tiles = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) tiles.push([x + 6 + dx, y + dy]);
    fx.pushBurst("nova", x + 6, y, "#e8742a", { tiles, el: "fire" }); // ultimate
  })();
});
await page.waitForTimeout(300);
await page.screenshot({ path: "scripts/tamer-art/fx_special.png" });
await page.waitForTimeout(500);
await page.screenshot({ path: "scripts/tamer-art/fx_special2.png" });
await browser.close();
console.log("done");
