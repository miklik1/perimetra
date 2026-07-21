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

// A context PER THEME, each with its `colorScheme` fixed at creation, so the
// emulated `prefers-color-scheme` is stable for the whole pass and ThemeEffect
// resolves it deterministically. The old localStorage `theme=dark` +
// `classList.add("dark")` technique RACED ThemeEffect and silently shot LIGHT on
// heavier pages (found 2026-07-21 in the ADR 0118 eyes-on; capture-configurator
// got this same fix). Preference is seeded to `system` so ThemeEffect reads the
// context's emulated scheme rather than a persisted override.
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    colorScheme: theme,
    viewport: { width: 1280, height: 1200 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[${theme}] ${String(e)}`));
  await page.addInitScript(() => {
    try {
      // eslint-disable-next-line no-undef -- runs in the browser via addInitScript
      localStorage.setItem("theme", "system");
    } catch {
      /* pre-hydration: storage may be unavailable */
    }
  });
  // `?theme=dark` flips the gallery's own subtitle copy; the actual `.dark` class
  // comes from the context scheme above.
  const url = `${BASE}/brand-lab${theme === "dark" ? "?theme=dark" : ""}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
  await page
    .locator("[data-slot='brand-lab']")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  // Assert the theme actually resolved (a light "dark" shot is the bug this
  // replaced the classList.add belt to catch, not paper over).
  await page
    .waitForFunction(
      (t) => document.documentElement.classList.contains("dark") === (t === "dark"),
      theme,
      { timeout: 5_000 },
    )
    .catch(() => errors.push(`[${theme}] theme did not resolve to ${theme}`));
  // Let variable fonts settle so the Chillax/Synonym/Amulya specimen is faithful.
  await page.evaluate(() => document.fonts.ready);
  const out = `${OUT_DIR}/brand-lab-${theme}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${out}`);
  await context.close();
}

await browser.close();
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
