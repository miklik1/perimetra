/**
 * Headless capture of Phase-2 Wave C (tenant `/admin` reskin) — the eyes for the
 * §12.1 responsive + both-themes pass on this display-less box. AUTHED-ONLY:
 * `/admin` needs an admin session (a signed-out hit redirects to /login), so
 * there is no anon context here (unlike Wave A). Signs in ONCE, reuses the
 * storage state, then for each theme × each ship-bar width navigates to `/admin`
 * and waits for a STRUCTURAL page-specific signal — the price-table form's first
 * `<select>` (currency/rounding enum), never a bare `<main>` (a transient dev-api
 * 404 renders a soft-200 shell) — before asserting theme + no horizontal body
 * scroll and screenshotting full page. Uses the context-per-theme `colorScheme`
 * technique (a localStorage seed + classList.add races ThemeEffect and shoots
 * LIGHT — the 2026-07-21 lesson).
 *
 *   BASE=http://localhost:3002 EMAIL=admin@perimetra.local PASSWORD=... \
 *     node apps/web/scripts/verify/capture-wave-c.mjs
 *
 * Env: BASE, EMAIL, PASSWORD, OUT_DIR (default apps/web/.verify/wave-c).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "perimetra-dev-2026";
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/wave-c";

if (!EMAIL) {
  console.error("EMAIL is required (admin, for the /admin capture)");
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

// Sign in ONCE (throttled 10/min) and reuse the storage state — `/admin` is
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

/** /admin — authed admin. Wait for the price-table form's first `<select>`
 *  (currency/rounding enum) — a STRUCTURAL signal that the admin body rendered,
 *  not the bare `<main>` a soft-200 shell would leave. */
async function captureAdmin(page, theme, vpName) {
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page
    .locator("form select")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] admin price-table form never appeared`));
  await assertThemeAndScroll(page, theme, vpName, "admin");
  const out = `${OUT_DIR}/admin-${vpName}-${theme}.png`;
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
    await captureAdmin(page, theme, vp.name);
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
