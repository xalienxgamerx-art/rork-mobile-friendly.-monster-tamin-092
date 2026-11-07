/** Probe: creation preview renders the new HD parts (768-wide canvas), no asset 404s. */
const { chromium } = await import(process.env.RORK_PLAYWRIGHT_MODULE ?? "/usr/local/lib/node_modules/playwright/index.mjs");

const base = process.argv[2] ?? "http://localhost:5199";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const fails = [];
const loaded = new Set();
page.on("response", (r) => { if (r.status() >= 400) fails.push(`${r.status()} ${r.url()}`); if (r.url().includes("_p")) loaded.add(r.url().split("/").pop()); });
page.on("console", (m) => { if (m.type() === "error") fails.push(`console: ${m.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByText("New Journey").click();
await page.waitForTimeout(2500);
await page.mouse.wheel(0, 2300);
await page.waitForTimeout(1500);

const cv = page.locator('canvas[aria-label="Your tamer"]');
await cv.waitFor({ state: "visible", timeout: 10000 });
const info = await cv.evaluate((el) => ({ w: el.width, h: el.height, css: el.style.width }));
console.log("tamer canvas:", JSON.stringify(info), info.w >= 384 ? "HD OK (device-pixel buffer)" : "LEGACY FALLBACK!");
await page.screenshot({ path: "scripts/tamer-art/live_create.png" });
console.log(fails.length ? "FAILURES:\n" + fails.join("\n") : "no 404s / console errors");
console.log("new-sprite files fetched:", [...loaded].sort().join(", ") || "NONE");
await browser.close();
