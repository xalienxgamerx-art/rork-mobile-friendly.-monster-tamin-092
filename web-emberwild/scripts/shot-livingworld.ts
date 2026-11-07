// One-off UI smoke: boots a new journey through the real UI, reaches the home
// town, opens the notices sheet, screenshots. PNG to /tmp/dumps.
import { chromium } from "playwright-core";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto("http://localhost:5199", { waitUntil: "load" });
await page.waitForTimeout(2000);

// title → new journey
await page.getByRole("button").first().click(); // mute? first button may be mute toggle; click the ember CTA by text
await page.goto("http://localhost:5199", { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.getByText(/new journey/i).click();
await page.waitForTimeout(1200);
// create screen: accept defaults, begin
await page.getByRole("button").last().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/dumps/lw-game.png" });

// open notices via the HUD — find a button titled notices/notices icon; try the standing/notices sheet buttons
const cand = page.getByText(/notices/i).first();
if (await cand.isVisible().catch(() => false)) {
  await cand.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/dumps/lw-notices.png" });
}
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
