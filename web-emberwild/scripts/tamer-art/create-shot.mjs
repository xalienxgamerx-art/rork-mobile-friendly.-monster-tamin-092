/** Screenshot the create screen's tamer preview canvas element. */
const { chromium } = await import(process.env.RORK_PLAYWRIGHT_MODULE ?? "/usr/local/lib/node_modules/playwright/index.mjs");
const base = process.argv[2] ?? "http://localhost:5199";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto(base, { waitUntil: "networkidle" });
await page.getByText("New Journey").click();
await page.waitForTimeout(2500);
await page.mouse.wheel(0, 2300);
await page.waitForTimeout(1500);
const cv = page.locator('canvas[aria-label="Your tamer"]');
await cv.waitFor({ state: "visible", timeout: 10000 });
const box = await cv.boundingBox();
console.log("canvas css box:", JSON.stringify(box));
await page.screenshot({ path: "scripts/tamer-art/create_live.png", clip: box });
await browser.close();
