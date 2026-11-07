/**
 * pipeline-sheet.mjs — assembles the labeled three-stage comparison sheet
 * (stages A/B/C + resampling mechanism) into pipeline_compare.png.
 * `node scripts/tamer-art/pipeline-sheet.mjs`
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("./", import.meta.url));
const b64 = (f) => readFileSync(`${dir}${f}`).toString("base64");
const img = (f, style = "") => `<img src="data:image/png;base64,${b64(f)}" style="max-width:100%;image-rendering:pixelated;${style}">`;
const label = (t) => `<div style="font-weight:700;color:#f0b060;margin:2px 0 4px">${t}</div>`;

const html = `<html><body style="margin:0;background:#262030;font:13px/1.45 system-ui;color:#e8e0d0">
<div style="padding:16px 20px;max-width:1500px">
<h2 style="margin:2px 0 12px">Modular sprite pipeline — three-stage comparison (one look: wayfarer / square / keen / braid, seed 20260422)</h2>
${label("A · generated part assets from public/tamers (nearest ×3)")}
${img("pipeline_stageA.png", "max-height:470px")}
<div style="display:flex;gap:28px;align-items:flex-start;margin-top:10px;flex-wrap:wrap">
  <div style="width:470px">${label("B · composeLook() output — native 128×192, ×2 nearest")}${img("pipeline_stageB.png")}</div>
  <div style="width:470px">${label("C · runtime: character creator, device capture (dpr 2)")}${img("pipeline_stageC_creator.png")}<div style="opacity:.75;margin-top:4px">in-page canvas readback vs B: 0 / 8 198 pixels differ — compositor → screen is pixel-exact</div></div>
</div>
<div style="display:flex;gap:28px;align-items:flex-start;margin-top:10px;flex-wrap:wrap">
  <div style="width:470px">${label("C · runtime: overworld player after the fix (×3 nearest)")}${img("pipeline_stageC_mapcrop.png")}</div>
  <div style="width:470px">${label("mechanism at dpr-1 desktop size (51 device px): nearest decimation (old draw) vs area-average pre-scale (fix)")}${img("pipeline_simulate.png")}<div style="opacity:.75;margin-top:4px">old draw: irregular row/column dropout — speckled hair, broken outlines; fix: every feature averaged in, blit then 1:1</div></div>
</div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1540, height: 1100 } });
await page.setContent(html);
await page.waitForTimeout(500);
await page.screenshot({ path: `${dir}pipeline_compare.png`, fullPage: true });
await browser.close();
console.log("pipeline_compare.png saved");
