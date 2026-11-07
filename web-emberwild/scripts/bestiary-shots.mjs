/** Screenshot the bestiary gallery for sprite QA. usage: node bestiary-shots.mjs <url> */
import { mkdirSync } from "node:fs";
const { chromium } = await import(process.env.RORK_PLAYWRIGHT_MODULE ?? "/usr/local/lib/node_modules/playwright/index.mjs");

const url = process.argv[2];
const out = "/tmp/perf-probe";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.getByRole("button", { name: /Bestiary/i }).click();
await page.waitForTimeout(1500);
for (let i = 0; i < 6; i++) {
  await page.screenshot({ path: `${out}/bestiary-${i}.png` });
  await page.touchscreen.tap(195, 500);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
}
await browser.close();
console.log("done");
