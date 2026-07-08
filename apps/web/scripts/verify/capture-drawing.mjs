/**
 * Headless 2D drawing capture (drawing-spike) — the eyes for the derived
 * technical drawing on this display-less box. Screenshots a static SVG/HTML
 * drawing (or, later, the /drawing-lab route) to PNG so the render can be SEEN
 * — the standing "never call a render correct without eyes on it" rule, for 2D.
 *
 *   SRC=file:///abs/path.html node apps/web/scripts/verify/capture-drawing.mjs
 *
 * Env: SRC (file:// URL or http URL), OUT (png path).
 */
import { chromium } from "@playwright/test";

const SRC = process.env.SRC ?? "http://localhost:3010/drawing-lab";
const OUT = process.env.OUT ?? "apps/web/.verify/drawing.png";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1000, height: 1400 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(SRC, { waitUntil: "networkidle", timeout: 60_000 });
const svg = page.locator("svg").first();
await svg.waitFor({ state: "visible", timeout: 30_000 });
await svg.screenshot({ path: OUT });
await browser.close();
console.log(`captured ${OUT}`);
if (errors.length) console.log("page errors:", errors);
