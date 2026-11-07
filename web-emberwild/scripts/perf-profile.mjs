/** CPU profile of one interaction phase. usage: node perf-profile.mjs <url> <mode>
 * modes: idle | tap | move-closed | move-open */
import { mkdirSync } from "node:fs";
const { chromium } = await import(process.env.RORK_PLAYWRIGHT_MODULE ?? "/usr/local/lib/node_modules/playwright/index.mjs");

const url = process.argv[2];
const mode = process.argv[3] ?? "idle";
mkdirSync("/tmp/perf-probe", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

await page.getByRole("button", { name: /New Journey/i }).click();
await page.getByRole("button", { name: /Choose a companion/i }).click();
await page.getByRole("button", { name: /Cindermaw/i }).first().click();
await page.getByRole("button", { name: /Choose Cindermaw/i }).click();
await page.locator("canvas").first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);

const cdp = await ctx.newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");

const box = await page.locator("canvas").first().boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

if (mode === "idle") {
  await page.waitForTimeout(3000);
} else if (mode === "tap") {
  for (const [dx, dy] of [[0, -60], [60, 0], [0, 60], [-60, 0], [0, -60]]) {
    await page.touchscreen.tap(cx + dx, cy + dy);
    await page.waitForTimeout(300);
  }
} else if (mode === "move-closed") {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? "ArrowDown" : "ArrowUp");
    await page.waitForTimeout(150);
  }
} else if (mode === "move-open") {
  await page.touchscreen.tap(cx, cy - 60);
  await page.waitForTimeout(400);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? "ArrowDown" : "ArrowUp");
    await page.waitForTimeout(150);
  }
}

const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas ?? [];
(profile.samples ?? []).forEach((id, i) => {
  const n = byId.get(id);
  if (!n) return;
  const cf = n.callFrame;
  const key = `${cf.functionName || "(anon)"} @ ${String(cf.url).split("/").pop()}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
});
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`MODE=${mode}  total sampled: ${(total / 1000).toFixed(0)}ms`);
for (const [k, v] of top) console.log(`${(v / 1000).toFixed(0).padStart(6)}ms  ${(100 * v / total).toFixed(1)}%  ${k}`);
await browser.close();
