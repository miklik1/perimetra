/**
 * Headless 3D capture harness (ADR 0073) — the eyes for this GPU-less box.
 * Drives a real (software-WebGL / SwiftShader) Chromium to `/scene-lab`, settles
 * a few animation frames, and screenshots the canvas to the gitignored
 * `.verify/` dir so the render can be SEEN (extrusion, lighting, the §6 amber).
 *
 * Software WebGL renders correct PIXELS (just slowly) — the visual is
 * trustworthy; only fps would be meaningless (we capture no fps). Reusable
 * across the v1 3D slices.
 *
 *   1. start the web dev server:  pnpm --filter web exec next dev -p 3010
 *   2. capture:                   node apps/web/scripts/verify/capture-scene.mjs
 *
 * Env: BASE_URL (default http://localhost:3010), OUT (default apps/web/.verify),
 * LABEL (output basename, default scene-lab), SETTLE_MS (default 6000).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3010";
const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? resolve(here, "../../.verify");
const LABEL = process.env.LABEL ?? "scene-lab";
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 6000);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

// The true renderer string — SwiftShader = software = visual-trustworthy.
const renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return "no-webgl2";
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
});

await page.goto(`${BASE_URL}/scene-lab`, { waitUntil: "networkidle", timeout: 120_000 });
const canvas = page.locator('[data-testid="scene-lab"] canvas');
await canvas.waitFor({ state: "visible", timeout: 120_000 });

// Settle damped cameras / lazy materials — software rAF is slow, cap by clock.
await page.evaluate(
  (ms) =>
    new Promise((res) => {
      const t0 = performance.now();
      const tick = () => (performance.now() - t0 > ms ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  SETTLE_MS,
);

const out = join(OUT, `${LABEL}.png`);
await canvas.screenshot({ path: out });
const box = await canvas.boundingBox();

const report = {
  label: LABEL,
  url: `${BASE_URL}/scene-lab`,
  renderer,
  softwareRenderer: /SwiftShader|llvmpipe|software/i.test(renderer),
  canvas: box ? { width: Math.round(box.width), height: Math.round(box.height) } : null,
  errors,
  capturedAt: new Date().toISOString(),
};
writeFileSync(join(OUT, `${LABEL}.report.json`), JSON.stringify(report, null, 2));

await browser.close();
console.log(`captured ${out}`);
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exitCode = 0; // surfaced in the report; never fail the capture
