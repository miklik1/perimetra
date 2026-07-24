/**
 * Headless capture of Phase-A Wave A1 (the invoice surface, ADR 0127) — the eyes
 * for the §12.1 responsive + both-themes pass on this display-less box.
 *
 * Captures three surfaces, all AUTHED-ONLY (admin/sales; workshop 403s the whole
 * surface by absence):
 *   /invoices                  the o-LIST list + the issue-from-order panel
 *   /invoices/:id              the §29 detail (payment + supersession + I3 verify)
 *   /invoices/:id/faktura      the chromeless print sheet
 *
 * Signs in ONCE and reuses the storage state (the auth throttle is 10/min), then
 * for each theme × each ship-bar width waits for a STRUCTURAL page-specific
 * signal before asserting theme + no horizontal body scroll and shooting full
 * page. Uses the context-per-theme `colorScheme` technique — seeding
 * localStorage and adding the class races ThemeEffect and shoots LIGHT (the
 * 2026-07-21 lesson).
 *
 * The print sheet is captured on SCREEN (its @page rules only apply to paper);
 * `print` emulation is applied for one extra shot per theme at 1280 so the
 * PrintSheetStyle dark-reset is actually exercised — a dark-themed sheet that
 * prints white-on-white is the defect this catches.
 *
 *   BASE=http://localhost:3002 EMAIL=a1-eyeson@perimetra.local PASSWORD=... \
 *     INVOICE_ID=<uuid> node apps/web/scripts/verify/capture-invoices.mjs
 *
 * Env: BASE, EMAIL, PASSWORD, INVOICE_ID, OUT_DIR (default apps/web/.verify/a1-invoices).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "perimetra-dev-2026";
const INVOICE_ID = process.env.INVOICE_ID;
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/a1-invoices";

if (!EMAIL || !INVOICE_ID) {
  console.error("EMAIL and INVOICE_ID are required");
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

/** Each surface names a structural signal that mounts only after the AuthGuard
 *  resolves and the framed content renders — never the bare fallback. */
const SURFACES = [
  { key: "list", path: "/invoices", signal: "h1" },
  { key: "detail", path: `/invoices/${INVOICE_ID}`, signal: "h1" },
  { key: "faktura", path: `/invoices/${INVOICE_ID}/faktura`, signal: "table" },
];

const browser = await chromium.launch({ headless: true });
const errors = [];

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

async function assertThemeAndScroll(page, theme, label) {
  await page
    .waitForFunction(
      (t) => document.documentElement.classList.contains("dark") === (t === "dark"),
      theme,
      { timeout: 5000 },
    )
    .catch(() => errors.push(`${label}: theme class never settled to ${theme}`));

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) errors.push(`${label}: body scrolls horizontally by ${overflow}px`);
}

for (const theme of THEMES) {
  const ctx = await browser.newContext({ storageState, colorScheme: theme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text().slice(0, 200)}`);
  });

  for (const surface of SURFACES) {
    for (const vp of VIEWPORTS) {
      const label = `${surface.key}/${theme}/${vp.name}`;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}${surface.path}`, { waitUntil: "networkidle" });
      await page
        .locator(surface.signal)
        .first()
        .waitFor({ state: "visible", timeout: 15000 })
        .catch(() => errors.push(`${label}: signal "${surface.signal}" never appeared`));
      await assertThemeAndScroll(page, theme, label);
      await page.screenshot({
        path: `${OUT_DIR}/${surface.key}-${theme}-${vp.name}.png`,
        fullPage: true,
      });
      console.log(`shot ${label}`);
    }
  }

  // The print sheet under real print emulation — the PrintSheetStyle dark reset
  // is load-bearing, not cosmetic: without it a dark-themed sheet prints
  // near-white ink onto white paper.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/invoices/${INVOICE_ID}/faktura`, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: `${OUT_DIR}/faktura-PRINT-${theme}.png`, fullPage: true });
  await page.emulateMedia({ media: "screen" });
  console.log(`shot faktura-PRINT/${theme}`);

  await ctx.close();
}

await browser.close();

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nOK — captures in ${OUT_DIR}`);
