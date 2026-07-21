/**
 * Headless capture of the Nastavení section index (1c-2) — the eyes for the
 * §12.1 responsive + both-themes pass on this display-less box. Signs in, then
 * screenshots the settings tab strip (`/account` and its sibling tabs) at every
 * width the ship bar names, in light and dark, so the surface can be SEEN rather
 * than inferred from green tests. Uses the context-per-theme `colorScheme`
 * technique (a localStorage seed + classList.add races ThemeEffect and shoots
 * LIGHT — capture-configurator's 2026-07-21 lesson).
 *
 *   BASE=http://localhost:3002 EMAIL=... PASSWORD=... \
 *     node apps/web/scripts/verify/capture-settings.mjs
 *
 * Env: BASE, EMAIL, PASSWORD, OUT_DIR (default apps/web/.verify/settings).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "Capture-pass-123!";
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/settings";

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

async function signInTo(context) {
  const res = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!res.ok()) {
    console.error(`sign-in failed: ${res.status()} ${await res.text()}`);
    process.exit(1);
  }
}

/** Load a settings surface, assert the theme + tab strip, measure H-scroll, shoot. */
async function capture(page, theme, vpName, route, label) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  // The section heading is the settings surface's own signal (the rail also
  // carries a "Nastavení" item, so scope to the heading role, not the text).
  await page
    .getByRole("heading", { name: "Nastavení" })
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] ${label}: settings heading never appeared`));
  await page
    .waitForFunction(
      (t) => document.documentElement.classList.contains("dark") === (t === "dark"),
      theme,
      { timeout: 10_000 },
    )
    .catch(() => errors.push(`[${theme} ${vpName}] theme did not resolve to ${theme}`));
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

  const out = `${OUT_DIR}/${label}-${vpName}-${theme}.png`;
  await page.screenshot({ path: out });
  console.log(`captured ${out}`);
}

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({ colorScheme: theme });
  await signInTo(context);
  console.log(`signed in (${theme})`);
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
    // The Account tab — every width, both themes (the primary tab-strip shot).
    await capture(page, theme, vp.name, "/account", "settings-account");
    // The admin surface at the two desktop frames — the FULL role-gated tab set
    // (Právní profil + Ceníky) + a different active tab, to prove the strip.
    if (vp.width >= 1280) {
      await capture(page, theme, vp.name, "/admin", "settings-admin");
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
