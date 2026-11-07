import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1200 } });
await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);
const dataUrl = await p.evaluate(async () => {
  const mod = await import('/src/game/tamerLook.ts');
  const { generateLook } = await import('/src/game/appearance.ts');
  const look = generateLook(20260422);
  const spr = await mod.getHDSprite(look);
  const c = document.createElement('canvas');
  c.width = spr.width; c.height = spr.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(spr.data), spr.width, spr.height), 0, 0);
  return c.toDataURL('image/png');
});
writeFileSync('/tmp/composed_full.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
await b.close();
console.log('ok');
