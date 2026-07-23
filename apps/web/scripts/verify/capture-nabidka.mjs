/**
 * Headless capture of the BUYER /nabidka/[token] landing (Phase-2 Wave B rebuild)
 * — the eyes for the §12.1 responsive + both-themes pass. This is a PUBLIC,
 * unauthenticated surface (the token is the credential), so no sign-in. Captures
 * the four buyer states against real seeded quotes: issued (BOM + accept/decline
 * + sticky bar), accepted, declined, superseded. Uses the context-per-theme
 * `colorScheme` technique (a localStorage seed + classList.add races ThemeEffect
 * and shoots LIGHT — the 2026-07-21 lesson).
 *
 *   BASE=http://localhost:3002 node apps/web/scripts/verify/capture-nabidka.mjs
 *
 * Env: BASE, OUT_DIR (default apps/web/.verify/nabidka).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/nabidka";
await mkdir(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "390-phone", width: 390, height: 844 },
  { name: "768-band", width: 768, height: 1024 },
  { name: "1024-portrait", width: 1024, height: 1366 },
  { name: "1194-tablet", width: 1194, height: 834 },
  { name: "1280-desktop", width: 1280, height: 900 },
  { name: "1440-desktop", width: 1440, height: 900 },
];
const SUBSET = new Set(["390-phone", "768-band", "1440-desktop"]);

// Share tokens are the buyer credential for LOCAL seeded quotes — passed via env,
// never committed (they are throwaway dev seed data, and a 32-hex literal trips
// the gitleaks pre-commit scan). Query them from the dev DB:
//   docker exec -i perimetra-postgres-1 psql -U app -d app -t -A -F'|' \
//     -c "SELECT document_number, status, share_token, superseded_by_id IS NOT NULL FROM quote ORDER BY document_number;"
// Then run with e.g. TOKEN_ISSUED=<...> TOKEN_ACCEPTED=<...> node …/capture-nabidka.mjs.
const STATES = [
  { name: "issued", token: process.env.TOKEN_ISSUED, all: true },
  { name: "accepted", token: process.env.TOKEN_ACCEPTED, all: false },
  { name: "declined", token: process.env.TOKEN_DECLINED, all: false },
  { name: "superseded", token: process.env.TOKEN_SUPERSEDED, all: false },
].filter((s) => s.token);
if (STATES.length === 0) {
  console.error(
    "No share tokens provided. Set at least one of TOKEN_ISSUED / TOKEN_ACCEPTED / " +
      "TOKEN_DECLINED / TOKEN_SUPERSEDED (buyer share tokens from the seeded quotes).",
  );
  process.exit(1);
}

const THEMES = process.env.THEME ? [process.env.THEME] : ["light", "dark"];
const browser = await chromium.launch({ headless: true });
const errors = [];

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

async function captureState(page, theme, vpName, state) {
  const res = await page.goto(`${BASE}/nabidka/${state.token}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  if (res && res.status() >= 400) {
    errors.push(
      `[${theme} ${vpName}] nabidka:${state.name} HTTP ${res.status()} (token may be stale — re-query the DB)`,
    );
  }
  // Wait for a LANDING-specific signal (the supplier section, present on every
  // buyer state) — NOT just <main>, which the global 404 page also has. A
  // transient api blip renders notFound() as HTTP 200 (App Router soft-404), so
  // a <main>-only wait would silently screenshot the 404 and give a false pass.
  await page
    .getByText("Dodavatel", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() =>
      errors.push(
        `[${theme} ${vpName}] nabidka:${state.name} landing never appeared (404/api blip? — supplier section missing)`,
      ),
    );
  await page.waitForTimeout(1000);
  await assertThemeAndScroll(page, theme, vpName, `nabidka:${state.name}`);
  const out = `${OUT_DIR}/nabidka-${state.name}-${vpName}-${theme}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${out}`);
}

for (const theme of THEMES) {
  const ctx = await browser.newContext({ colorScheme: theme });
  console.log(`context ready (${theme})`);
  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      if (!state.all && !SUBSET.has(vp.name)) continue;
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[${theme} ${vp.name}] ${state.name} ${String(e)}`));
      page.on("console", (m) => {
        if (m.type() === "error")
          errors.push(`[${theme} ${vp.name}] ${state.name} console: ${m.text()}`);
      });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(() => {
        try {
          // eslint-disable-next-line no-undef -- runs in the browser
          localStorage.setItem("theme", "system");
        } catch {
          /* pre-hydration */
        }
      });
      await captureState(page, theme, vp.name, state);
      await page.close();
    }
  }
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.log("\nISSUES:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("\nno page errors, no horizontal body scroll at any width");
}
