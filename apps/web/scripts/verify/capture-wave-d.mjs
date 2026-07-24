/**
 * Headless capture of Phase-2 Wave D (the "/" owner dashboard reskin) — the eyes
 * for the §12.1 responsive + both-themes pass on this display-less box.
 * AUTHED-ONLY: "/" is the authenticated home (an unauthed hit renders the
 * AuthGuard fallback / redirects to /login), so there is no anon context. Signs
 * in ONCE, reuses the storage state, then for each theme × each ship-bar width
 * navigates to "/" and waits for a STRUCTURAL page-specific signal — the
 * dashboard greeting <h1> (DisplayLabel), which mounts only AFTER the AuthGuard
 * resolves and the framed content renders, never the bare AuthGuard fallback
 * ("checkingSession" text has no <h1>) — before asserting theme + no horizontal
 * body scroll and screenshotting full page. Uses the context-per-theme
 * `colorScheme` technique (a localStorage seed + classList.add races ThemeEffect
 * and shoots LIGHT — the 2026-07-21 lesson).
 *
 *   BASE=http://localhost:3002 EMAIL=admin@perimetra.local PASSWORD=... \
 *     node apps/web/scripts/verify/capture-wave-d.mjs
 *
 * Env: BASE, EMAIL, PASSWORD, OUT_DIR (default apps/web/.verify/wave-d).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "perimetra-dev-2026";
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/wave-d";

if (!EMAIL) {
  console.error("EMAIL is required (admin, for the / dashboard capture)");
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

// Sign in ONCE (throttled 10/min) and reuse the storage state — "/" is
// authed-only, so every capture rides the same session.
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

/** "/" — authed dashboard. Wait for the greeting <h1> (the framed content
 *  mounted, not the bare AuthGuard fallback). */
async function captureDashboard(page, theme, vpName) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page
    .locator("main h1")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] dashboard greeting never appeared`));
  await assertThemeAndScroll(page, theme, vpName, "dashboard");
  const out = `${OUT_DIR}/dashboard-${vpName}-${theme}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${out}`);
}

async function seedTheme(page) {
  await page.addInitScript(() => {
    try {
      // eslint-disable-next-line no-undef -- runs in the browser
      localStorage.setItem("theme", "system");
    } catch {
      /* pre-hydration: storage may be unavailable */
    }
  });
}

for (const theme of THEMES) {
  const authed = await browser.newContext({ colorScheme: theme, storageState });
  console.log(`context ready (${theme})`);
  for (const vp of VIEWPORTS) {
    const page = await authed.newPage();
    page.on("pageerror", (e) => errors.push(`[${theme} ${vp.name}] ${String(e)}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${theme} ${vp.name}] console: ${m.text()}`);
    });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seedTheme(page);
    await captureDashboard(page, theme, vp.name);
    await page.close();
  }
  await authed.close();
}

await browser.close();
if (errors.length) {
  console.log("\nISSUES:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("\nno page errors, no horizontal body scroll at any width");
}
