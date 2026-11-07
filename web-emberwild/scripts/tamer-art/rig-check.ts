// Renders every expression preset + a few styles with the ported rig → PNG strip
import { writeFileSync } from "node:fs";
import { encodePng } from "./png.ts";
import { EXPR, STYLE_PRESETS, DEFAULT_LAYOUT, DEFAULT_PALETTE, drawFace, mixStates, ExpressionRig } from "../../src/game/faceRig.ts";

const names = Object.keys(EXPR);
const Z = 3, W = DEFAULT_LAYOUT.width * Z, H = DEFAULT_LAYOUT.height * Z;
const strip = new Uint8Array(W * names.length * H * 4);
names.forEach((n, i) => {
  const buf = drawFace(EXPR[n]);
  for (let y = 0; y < buf.height; y++)
    for (let x = 0; x < buf.width; x++) {
      const si = (y * buf.width + x) * 4;
      if (buf.data[si + 3] === 0) continue;
      for (let py = 0; py < Z; py++) for (let px = 0; px < Z; px++) {
        const o = (((i * H) + y * Z + py) * W + x * Z + px) * 4;
        strip[o] = buf.data[si]; strip[o+1] = buf.data[si+1]; strip[o+2] = buf.data[si+2]; strip[o+3] = 255;
      }
    }
});
writeFileSync("/home/user/rork-app/web-emberwild/scripts/tamer-art/rig_expr_check.png", encodePng(W * names.length, H, strip));
console.log("presets:", names.join(","));
// animator sanity: blink should close eyes then reopen
const rig = new ExpressionRig(EXPR.neutral, 7);
rig.set(EXPR.joy, 0.2);
for (const dt of [0.05, 0.1, 0.2, 0.4]) {
  const s = rig.update(dt);
  console.log("t", dt, "eyeL.open", s.eyeL.open.toFixed(2), "mouth.open", s.mouth.open.toFixed(2), "smile", s.mouth.smile.toFixed(2));
}
