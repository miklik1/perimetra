/**
 * Headless capture of the workshop PRODUCTION view (CAR-24, ADR 0101) — Martin's
 * standing eyes-on rule (see `verify-3d-headless`'s sibling: this route is 2D/DOM,
 * no WebGL, but the same "SEE the actual render, don't trust tests alone" bar
 * applies). Logs in through the REAL `/login` form (a real Better Auth session,
 * not a stubbed cookie) and screenshots `/quotes/:id/production`.
 *
 * This script does NOT seed data — it drives an already-issued quote. Point it
 * at one via EMAIL/PASSWORD/QUOTE_ID (an org member who can reach the quote —
 * admin/sales/workshop all can, production is role-independent).
 *
 *   1. start the dev stack:  pnpm --filter api dev        # :4002
 *                            WEB_PORT=3002 pnpm dev:web    # :3002
 *   2. issue a quote (however you like) and note its id
 *   3. capture:  EMAIL=... PASSWORD=... QUOTE_ID=... \
 *                node apps/web/scripts/verify/capture-production.mjs
 *
 * Env: WEB_URL (default http://localhost:3002), OUT (default apps/web/.verify),
 * LABEL (output basename, default quote-production).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const QUOTE_ID = process.env.QUOTE_ID;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? resolve(here, "../../.verify");
const LABEL = process.env.LABEL ?? "quote-production";
// Override to capture a different authed route with the same login flow (e.g.
// `/quotes` to eyes-on the workshop row-routing, CAR-24).
const ROUTE = process.env.ROUTE ?? (QUOTE_ID ? `/quotes/${QUOTE_ID}/production` : undefined);

if (!EMAIL || !PASSWORD || !ROUTE) {
  console.error(
    "Usage: EMAIL=... PASSWORD=... QUOTE_ID=... [ROUTE=/quotes] node capture-production.mjs",
  );
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

// Real sign-in through the login form (not a stubbed cookie) — the same path a
// workshop user actually takes.
await page.goto(`${WEB_URL}/login`, { waitUntil: "networkidle", timeout: 60_000 });
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });

const url = `${WEB_URL}${ROUTE}`;
await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
// The document header renders once the query resolves.
await page
  .locator('[data-slot="display-label"], h1, main')
  .first()
  .waitFor({ state: "visible", timeout: 30_000 });
// Let SVG drawings + fonts settle.
await page.waitForTimeout(1000);

const out = join(OUT, `${LABEL}.png`);
await page.screenshot({ path: out, fullPage: true });

const bodyText = await page.locator("body").innerText();
const report = {
  label: LABEL,
  url,
  errors,
  containsMoneySymbol: bodyText.includes("Kč"),
  capturedAt: new Date().toISOString(),
};
writeFileSync(join(OUT, `${LABEL}.report.json`), JSON.stringify(report, null, 2));

await browser.close();
console.log(`captured ${out}`);
console.log(JSON.stringify(report, null, 2));
