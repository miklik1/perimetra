/**
 * Headless design-system capture (ADR 0111) — the eyes for the component kit on
 * this display-less box. Full-page screenshots the `/brand-lab` gallery in both
 * the light and dark variants so the tuned tokens + primitives can be SEEN — the
 * standing "never call a render correct without eyes on it" rule, for the 2D kit.
 *
 *   BASE=http://localhost:3020 node apps/web/scripts/verify/capture-brand.mjs
 *
 * Env: BASE (dev-server origin), OUT_DIR (png dir, default apps/web/.verify).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3020";
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify";
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1200 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (e) => errors.push(`[${theme}] ${String(e)}`));
  // Drive dark the app's real way: seed the persisted preference so the no-FOUC
  // script + theme store both resolve dark and add `.dark` to <html> (the
  // `@custom-variant dark` seam). `?theme=dark` also flips the gallery subtitle.
  if (theme === "dark") {
    await page.addInitScript(() => {
      try {
        // eslint-disable-next-line no-undef -- runs in the browser via addInitScript
        localStorage.setItem("theme", "dark");
      } catch {
        /* pre-hydration: storage may be unavailable */
      }
    });
  }
  const url = `${BASE}/brand-lab${theme === "dark" ? "?theme=dark" : ""}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
  await page
    .locator("[data-slot='brand-lab']")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  // Belt-and-suspenders: force the class in case the store defaulted to system.
  if (theme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  // Let variable fonts settle so the Chillax/Synonym/Amulya specimen is faithful.
  await page.evaluate(() => document.fonts.ready);
  const out = `${OUT_DIR}/brand-lab-${theme}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${out}`);
  await page.close();
}

await browser.close();
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
