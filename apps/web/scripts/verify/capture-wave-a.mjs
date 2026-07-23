/**
 * Headless capture of Phase-2 Wave A (auth-chrome + legal-profile reskin) — the
 * eyes for the §12.1 responsive + both-themes pass on this display-less box.
 * Captures the UNAUTHENTICATED /login + /two-factor (fresh context, no cookie —
 * a signed-in context would redirect /login away) and the AUTHENTICATED admin
 * /team/legal-profile, at every ship-bar width in light + dark. Uses the
 * context-per-theme `colorScheme` technique (a localStorage seed + classList.add
 * races ThemeEffect and shoots LIGHT — the 2026-07-21 lesson).
 *
 *   BASE=http://localhost:3002 EMAIL=admin@perimetra.local PASSWORD=... \
 *     node apps/web/scripts/verify/capture-wave-a.mjs
 *
 * Env: BASE, EMAIL, PASSWORD, OUT_DIR (default apps/web/.verify/wave-a).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "perimetra-dev-2026";
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/wave-a";

if (!EMAIL) {
  console.error("EMAIL is required (admin, for the /team/legal-profile capture)");
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

// Sign in ONCE (throttled 10/min) and reuse the storage state — only needed for
// the authed /team/legal-profile; /login + /two-factor render pre-session.
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

/** /login — pre-session; wait for the password field (structural, label-agnostic). */
async function captureLogin(page, theme, vpName) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page
    .locator('input[type="password"]')
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] login password field never appeared`));
  await assertThemeAndScroll(page, theme, vpName, "login");
  const out = `${OUT_DIR}/login-${vpName}-${theme}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${out}`);
}

/** /two-factor — direct nav (no real mid-flow state on this box). Screenshot
 *  whatever renders; note the final URL so a redirect-to-/login is visible. */
async function captureTwoFactor(page, theme, vpName) {
  await page.goto(`${BASE}/two-factor`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(1200);
  await assertThemeAndScroll(page, theme, vpName, "two-factor");
  const finalUrl = page.url();
  if (!finalUrl.includes("/two-factor")) {
    console.log(
      `  [${theme} ${vpName}] /two-factor redirected → ${finalUrl} (no mid-flow state; layout still shot)`,
    );
  }
  const out = `${OUT_DIR}/two-factor-${vpName}-${theme}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${out}`);
}

/** /team/legal-profile — authed admin; wait for a text input (the name field). */
async function captureLegalProfile(page, theme, vpName) {
  await page.goto(`${BASE}/team/legal-profile`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page
    .locator('input[type="text"], input:not([type])')
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] legal-profile form field never appeared`));
  await assertThemeAndScroll(page, theme, vpName, "legal-profile");
  const out = `${OUT_DIR}/legal-profile-${vpName}-${theme}.png`;
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
  // Unauthenticated context for the pre-session auth screens.
  const anon = await browser.newContext({ colorScheme: theme });
  // Authenticated context for the settings sub-page.
  const authed = await browser.newContext({ colorScheme: theme, storageState });
  console.log(`contexts ready (${theme})`);
  for (const vp of VIEWPORTS) {
    const ap = await anon.newPage();
    ap.on("pageerror", (e) => errors.push(`[${theme} ${vp.name}] ${String(e)}`));
    ap.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${theme} ${vp.name}] console: ${m.text()}`);
    });
    await ap.setViewportSize({ width: vp.width, height: vp.height });
    await seedTheme(ap);
    await captureLogin(ap, theme, vp.name);
    await captureTwoFactor(ap, theme, vp.name);
    await ap.close();

    const lp = await authed.newPage();
    lp.on("pageerror", (e) => errors.push(`[${theme} ${vp.name}] ${String(e)}`));
    lp.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${theme} ${vp.name}] console: ${m.text()}`);
    });
    await lp.setViewportSize({ width: vp.width, height: vp.height });
    await seedTheme(lp);
    await captureLegalProfile(lp, theme, vp.name);
    await lp.close();
  }
  await anon.close();
  await authed.close();
}

await browser.close();
if (errors.length) {
  console.log("\nISSUES:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("\nno page errors, no horizontal body scroll at any width");
}
