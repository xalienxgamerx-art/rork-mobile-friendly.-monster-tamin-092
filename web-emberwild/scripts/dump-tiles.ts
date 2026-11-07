// One-off visual probe: renders cliff compositor cases in a real browser and
// saves PNGs to /tmp/dumps. Run: bunx playwright-compatible bun script.
import { chromium } from "playwright-core";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:5199", { waitUntil: "load" });
await page.waitForTimeout(2500);

const dumps = await page.evaluate(async () => {
  const T = await import("/src/game/tiles.ts");
  await new Promise<void>((res) => {
    const off = T.onHeightTexReady(() => res());
    setTimeout(res, 4000);
  });
  type Drops = { n: number; e: number; s: number; w: number; ne: number; se: number; sw: number; nw: number };
  const NONE: Drops = { n: 0, e: 0, s: 0, w: 0, ne: 0, se: 0, sw: 0, nw: 0 };
  const out: Record<string, string> = {};
  const cases: Record<string, Drops> = {
    north_only: { ...NONE, n: 1 },
    inner_ne: { ...NONE, n: 1, e: 1 },
    convex_ne: { ...NONE, n: 1, e: 1, ne: 1 },
    two_pairs: { ...NONE, n: 1, e: 1, s: 1 },
    all_four: { ...NONE, n: 1, e: 1, s: 1, w: 1 },
    convex_deep: { ...NONE, n: 2, e: 2, ne: 2 },
  };
  for (const [name, drops] of Object.entries(cases)) {
    const tile = T.cliffConnectTex("sand", 0, drops) as HTMLCanvasElement | null;
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const cx = cv.getContext("2d")!;
    cx.imageSmoothingEnabled = false;
    cx.fillStyle = "#7da05a";
    cx.fillRect(0, 0, 128, 128);
    if (tile) cx.drawImage(tile, 0, 0, 128, 128);
    out[name] = cv.toDataURL("image/png");
  }
  // flowing water: rapids, a fall down a rock face, and the splash at its base
  const water = (paint: (cx: CanvasRenderingContext2D) => void): string => {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const cx = cv.getContext("2d")!;
    cx.imageSmoothingEnabled = false;
    paint(cx);
    return cv.toDataURL("image/png");
  };
  const river = "#4c93c9";
  out.rapids_south = water((cx) => {
    cx.fillStyle = river;
    cx.fillRect(0, 0, 128, 128);
    cx.drawImage(T.rapidsTex("s"), 0, 0, 128, 128);
  });
  out.waterfall_north = water((cx) => {
    cx.fillStyle = "#7da05a";
    cx.fillRect(0, 0, 128, 128);
    const face = T.cliffConnectTex("sand", 0, { ...NONE, n: 2 });
    if (face) cx.drawImage(face, 0, 0, 128, 128);
    cx.drawImage(T.waterfallTex("n", 2), 0, 0, 128, 128);
  });
  out.fall_foam = water((cx) => {
    cx.fillStyle = river;
    cx.fillRect(0, 0, 128, 128);
    cx.drawImage(T.fallFoamTex("n"), 0, 0, 128, 128);
  });
  return out;
});

for (const [name, data] of Object.entries(dumps)) {
  const b64 = data.split(",")[1];
  await Bun.write(`/tmp/dumps/${name}.png`, Buffer.from(b64, "base64"));
  console.log("saved", name);
}
await browser.close();
