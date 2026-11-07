/** evidence-sheet.mjs — assembles the A–F raw-art HD evidence sheet. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const d = fileURLToPath(new URL("./", import.meta.url));
const b64 = (f) => readFileSync(`${d}${f}`).toString("base64");
const img = (f, style = "") => `<img src="data:image/png;base64,${b64(f)}" style="max-width:100%;${style}">`;
const label = (t) => `<div style="font-weight:700;color:#f0b060;margin:2px 0 4px">${t}</div>`;

const html = `<html><body style="margin:0;background:#262030;font:13px/1.45 system-ui;color:#e8e0d0">
<div style="padding:16px 20px;max-width:1560px">
<h2 style="margin:2px 0 12px">Raw-art HD pipeline — one look end to end (creator default: wayfarer / keen / braid, golden hair)</h2>
<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
  <div style="width:600px">${label("A · raw source artwork (authoritative)")}${img("evidence_A_raw.png")}</div>
  <div style="width:280px">${label("B · old composite — region-indexed 8-shade ramp (128×192)")}${img("evidence_B_legacy.png", "image-rendering:pixelated;width:256px")}</div>
  <div style="width:280px">${label("D · new composite — raw art + mask recolor, native 768×1152")}${img("evidence_D_hd.png", "width:256px")}</div>
</div>
<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;margin-top:12px">
  <div style="width:300px">${label("E/F · runtime before: creator + overworld (region-indexed source)")}${img("stageC_creator_old.png", "width:260px")}${img("evidence_F_map_old.png", "width:260px;margin-top:8px")}</div>
  <div style="width:300px">${label("E/F · runtime after: creator canvas backs at 768×1152; overworld player from HD")}${img("pipeline_stageC_creator.png", "width:260px")}${img("evidence_F_map_new.png", "width:260px;margin-top:8px")}</div>
</div>
<div style="opacity:.75;margin-top:10px">The raw art (A) survives to rendering (D): painterly hair strands, garment folds, studs and satchel detail, ink outlines — recoloring is a luminance-preserving transfer through per-part masks, never a ramp reconstruction.</div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1580, height: 1000 } });
await page.setContent(html);
await page.waitForTimeout(400);
await page.screenshot({ path: `${d}evidence_A-F.png`, fullPage: true });
await browser.close();
console.log("evidence_A-F.png saved");
