/**
 * Headless capture of the Zakázky surface (W7 Phase 2 orders reskin) — the eyes
 * for the §12.1 responsive + both-themes pass on this display-less box. Signs in,
 * then screenshots the reskinned /orders LIST at every ship-bar width in light +
 * dark, plus the price-blind /orders/:id/production DETAIL chrome, so the surface
 * can be SEEN against the canvas o-LIST / o-DETAIL rather than inferred from green
 * tests. Uses the context-per-theme `colorScheme` technique (a localStorage seed +
 * classList.add races ThemeEffect and shoots LIGHT — the 2026-07-21 lesson).
 *
 *   BASE=http://localhost:3002 EMAIL=admin@perimetra.local PASSWORD=... \
 *     ORDER_ID=<uuid> node apps/web/scripts/verify/capture-orders.mjs
 *
 * Env: BASE, EMAIL, PASSWORD, ORDER_ID (an in_production order in the session's
 * org, for the detail), OUT_DIR (default apps/web/.verify/orders).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "perimetra-dev-2026";
const ORDER_ID = process.env.ORDER_ID;
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/orders";

if (!EMAIL) {
  console.error("EMAIL is required");
  process.exit(1);
}
await mkdir(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "390-phone", width: 390, height: 844 },
  { name: "768-band", width: 768, height: 1024 },
  { name: "1024-portrait", width: 1024, height: 1366 },
  { name: "1194-tablet", width: 1194, height: 834 },
  { name: "1280-desktop", width: 1280, height: 900 },
  { name: "1440-desktop", width: 1440, height: 900 },
];

const browser = await chromium.launch({ headless: true });
const errors = [];

// Sign in ONCE and reuse the storage state across both theme contexts — the
// auth sign-in endpoint is throttled (10/min), and page loads consume the
// budget, so a second per-context sign-in 429s. One sign-in, cookie reused.
async function signInOnce() {
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${BASE}/api/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!res.ok()) {
    console.error(`sign-in failed: ${res.status()} ${await res.text()}`);
    process.exit(1);
  }
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}
const storageState = await signInOnce();
console.log("signed in once (storage state captured)");

const THEMES = process.env.THEME ? [process.env.THEME] : ["light", "dark"];

async function assertThemeAndScroll(page, theme, vpName, label) {
  await page
    .waitForFunction(
      (t) => document.documentElement.classList.contains("dark") === (t === "dark"),
      theme,
      { timeout: 10_000 },
    )
    .catch(() => errors.push(`[${theme} ${vpName}] ${label} theme did not resolve to ${theme}`));
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth) {
    errors.push(
      `[${theme} ${vpName}] ${label} HORIZONTAL BODY SCROLL: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
    );
  }
}

/** The /orders LIST — the heading is the surface's own signal (the rail also
 *  carries a "Zakázky" item, so scope to the heading role, not the text). */
async function captureList(page, theme, vpName) {
  await page.goto(`${BASE}/orders`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page
    .getByRole("heading", { name: "Zakázky" })
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] orders heading never appeared`));
  // The seeded table (Z2026/0001..0004) — wait for a known row so the populated
  // table, not a transient skeleton, is what gets shot.
  await page
    .getByText("Z2026/0001")
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] orders table row never appeared`));
  await assertThemeAndScroll(page, theme, vpName, "orders-list");
  const out = `${OUT_DIR}/orders-list-${vpName}-${theme}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${out}`);
}

/** The price-blind /orders/:id/production DETAIL chrome (breadcrumb + frame). */
async function captureDetail(page, theme, vpName) {
  if (!ORDER_ID) return;
  await page.goto(`${BASE}/orders/${ORDER_ID}/production`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page
    .getByRole("navigation", { name: "Zakázky" })
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] detail breadcrumb never appeared`));
  await assertThemeAndScroll(page, theme, vpName, "orders-detail");
  const out = `${OUT_DIR}/orders-detail-${vpName}-${theme}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${out}`);
}

for (const theme of THEMES) {
  const context = await browser.newContext({ colorScheme: theme, storageState });
  console.log(`context ready (${theme})`);
  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`[${theme} ${vp.name}] ${String(e)}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${theme} ${vp.name}] console: ${m.text()}`);
    });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.addInitScript(() => {
      try {
        // eslint-disable-next-line no-undef -- runs in the browser
        localStorage.setItem("theme", "system");
      } catch {
        /* pre-hydration: storage may be unavailable */
      }
    });
    await captureList(page, theme, vp.name);
    // Detail at the three representative frames (mobile / tablet-on-site / desktop).
    if (["390-phone", "1194-tablet", "1440-desktop"].includes(vp.name)) {
      await captureDetail(page, theme, vp.name);
    }
    await page.close();
  }
  await context.close();
}

await browser.close();
if (errors.length) {
  console.log("\nISSUES:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("\nno page errors, no horizontal body scroll at any width");
}
