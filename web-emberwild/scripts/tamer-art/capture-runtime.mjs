/**
 * capture-runtime.mjs — stage C of the pipeline comparison: captures the
 * ACTUAL runtime rendering of the modular sprite.
 *   1. character creator: the LookSprite canvas element, device pixels
 *   2. overworld: the map canvas with the player centered
 *
 * `node scripts/tamer-art/capture-runtime.mjs <previewUrl>`
 * → scripts/tamer-art/pipeline_stageC_creator.png / pipeline_stageC_map.png
 *   + prints measured canvas geometry as JSON.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const url = process.argv[2] ?? "https://1b0hl9azrmnvy4flb5z8x-web-emberwild.rork.live";
const OUT = fileURLToPath(new URL("./", import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("pageerror:", e.message));

await page.goto(url, { waitUntil: "networkidle" });

// title → creator
await page.locator("button.btn-ember").first().click();

// creator: wait until the tamer canvas actually has sprite pixels
const canvas = page.locator('canvas[aria-label="Your tamer"]');
await canvas.waitFor({ state: "visible", timeout: 20000 });
await page.waitForFunction(
  () => {
    const cv = document.querySelector('canvas[aria-label="Your tamer"]');
    if (!cv) return false;
    const c = cv.getContext("2d");
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
    return false;
  },
  undefined,
  { timeout: 20000 },
);

const geom = await page.evaluate(() => {
  const cv = document.querySelector('canvas[aria-label="Your tamer"]');
  const r = cv.getBoundingClientRect();
  return { cssW: r.width, cssH: r.height, backingW: cv.width, backingH: cv.height, dpr: window.devicePixelRatio };
});
console.log("creator geometry:", JSON.stringify(geom));

await canvas.screenshot({ path: `${OUT}pipeline_stageC_creator.png`, animations: "disabled" });

// overworld: name → continue → begin
await page.locator("input").first().fill("Rune");
await page.getByRole("button", { name: /choose a companion/i }).click();
await page.getByRole("button", { name: /^choose /i }).click();
const mapCanvas = page.locator("canvas").first();
await mapCanvas.waitFor({ state: "visible", timeout: 20000 });
await page.waitForTimeout(2500); // parts compose + first frames settle
const mapGeom = await page.evaluate(() => {
  const cv = document.querySelector("canvas");
  return { backingW: cv.width, backingH: cv.height, dpr: window.devicePixelRatio, cssW: cv.getBoundingClientRect().width };
});
console.log("map geometry:", JSON.stringify(mapGeom));
await mapCanvas.screenshot({ path: `${OUT}pipeline_stageC_map.png`, animations: "disabled" });

await browser.close();
console.log("stage C captured");
