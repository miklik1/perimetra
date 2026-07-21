/**
 * Headless capture of the Projekty + Zákazníci surfaces (W7 Phase 2 surface 3
 * reskin, ADR 0121) — the eyes for the §12.1 responsive + both-themes pass.
 * Signs in once (reused storageState — the auth endpoint is throttled), then
 * screenshots the reskinned /projects o-LIST (list-only) and the /customers
 * o-LIST + the /customers/:id sectioned detail at every ship-bar width in
 * light + dark. Context-per-theme `colorScheme` (a localStorage seed races
 * ThemeEffect and shoots LIGHT).
 *
 *   BASE=http://localhost:3002 EMAIL=admin@perimetra.local PASSWORD=... \
 *     DETAIL_ID=<customer-uuid> \
 *     node apps/web/scripts/verify/capture-projects-customers.mjs
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "perimetra-dev-2026";
const DETAIL_ID = process.env.DETAIL_ID;
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/projects-customers";

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

async function captureList(page, theme, vpName, route, waitText, tag) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page
    .getByText(waitText)
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] ${tag} table row never appeared`));
  await assertThemeAndScroll(page, theme, vpName, tag);
  await page.screenshot({ path: `${OUT_DIR}/${tag}-${vpName}-${theme}.png`, fullPage: true });
  console.log(`captured ${tag}-${vpName}-${theme}`);
}

async function captureDetail(page, theme, vpName, id) {
  if (!id) return;
  await page.goto(`${BASE}/customers/${id}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page
    .getByText("Stavby Morava")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => errors.push(`[${theme} ${vpName}] customer detail titleband never appeared`));
  await assertThemeAndScroll(page, theme, vpName, "customer-detail");
  await page.screenshot({
    path: `${OUT_DIR}/customer-detail-${vpName}-${theme}.png`,
    fullPage: true,
  });
  console.log(`captured customer-detail-${vpName}-${theme}`);
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
        /* pre-hydration */
      }
    });
    await captureList(page, theme, vp.name, "/projects", "Rodinný dům Novákovi", "projects-list");
    await captureList(page, theme, vp.name, "/customers", "Stavby Morava", "customers-list");
    // Detail (the full customer — sectioned Panels + titleband) at three frames.
    if (["390-phone", "1194-tablet", "1440-desktop"].includes(vp.name)) {
      await captureDetail(page, theme, vp.name, DETAIL_ID);
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
