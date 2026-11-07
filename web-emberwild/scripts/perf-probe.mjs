/**
 * Performance probe for the inspect screen + sprite QA.
 * Boots a fresh game in the live preview, measures frame timing with and
 * without the inspector open, and screenshots the world + bestiary.
 *
 * Usage: node scripts/perf-probe.mjs <preview-url> [outDir]
 */
import { mkdirSync } from "node:fs";
const { chromium } = await import(process.env.RORK_PLAYWRIGHT_MODULE ?? "/usr/local/lib/node_modules/playwright/index.mjs");

const url = process.argv[2];
const out = process.argv[3] ?? "/tmp/perf-probe";
mkdirSync(out, { recursive: true });
if (!url) throw new Error("usage: node scripts/perf-probe.mjs <preview-url> [outDir]");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__longtasks = [];
  window.__frames = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longtasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) })))
      .observe({ entryTypes: ["longtask"] });
  } catch {}
  let last = performance.now();
  const loop = (t) => {
    window.__frames.push(t - last);
    if (window.__frames.length > 4000) window.__frames.splice(0, 1000);
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200)); });

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

const stats = (label) =>
  page.evaluate((label) => {
    const f = window.__frames.splice(0);
    const lt = window.__longtasks.splice(0);
    f.sort((a, b) => a - b);
    const q = (p) => f.length ? Math.round(f[Math.floor(f.length * p)]) : 0;
    return {
      label,
      frames: f.length,
      avgMs: f.length ? Math.round(f.reduce((a, b) => a + b, 0) / f.length) : 0,
      p50: q(0.5), p90: q(0.9), p99: q(0.99), max: f.length ? Math.round(f[f.length - 1]) : 0,
      longTasks: lt.length, longTaskTotalMs: lt.reduce((a, b) => a + b.dur, 0),
      worst: lt.sort((a, b) => b.dur - a.dur).slice(0, 5),
    };
  }, label);

const mark = async (label, fn) => {
  await page.evaluate(() => { window.__frames.splice(0); window.__longtasks.splice(0); });
  await fn();
  const s = await stats(label);
  console.log(JSON.stringify(s));
};

// --- boot a game ---
await page.getByRole("button", { name: /New Journey/i }).click();
await page.getByRole("button", { name: /Choose a companion/i }).click();
await page.getByRole("button", { name: /Cindermaw/i }).first().click();
await page.getByRole("button", { name: /Choose Cindermaw/i }).click();
await page.locator("canvas").first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/world.png` });

// --- A: baseline idle (inspector closed) ---
await mark("idle-no-inspector", () => page.waitForTimeout(4000));

// --- B: open the inspector on nearby tiles (tap several tiles) ---
await mark("open-inspector", async () => {
  const box = await page.locator("canvas").first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const [dx, dy] of [[0, -60], [60, 0], [0, 60], [-60, 0], [30, -60]]) {
    await page.touchscreen.tap(cx + dx, cy + dy);
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(1500);
});
await page.screenshot({ path: `${out}/inspector.png` });

// --- C: idle with the inspector open ---
await mark("idle-inspector-open", () => page.waitForTimeout(4000));

// --- D: move around with the inspector open ---
await mark("move-inspector-open", async () => {
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(160);
  }
});

await page.screenshot({ path: `${out}/after-move.png` });

await browser.close();
console.log("done");
