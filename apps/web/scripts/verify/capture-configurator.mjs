/**
 * Headless configurator capture (ADR 0116) — the eyes for the §12.1 item 6
 * responsive + both-themes pass on this display-less box. Signs in, then
 * screenshots `/configurator` at every width the ship bar names, in light and
 * dark, so the surface can be SEEN rather than inferred from green tests.
 *
 *   BASE=http://localhost:3002 EMAIL=... PASSWORD=... \
 *     node apps/web/scripts/verify/capture-configurator.mjs
 *
 * The widths are the ship bar's, not a round-number selection: 390 (phone),
 * 768 (the band the canvas never drew), 1024 PORTRAIT (the tablet orientation
 * §12.1 calls out explicitly), 1194 (tablet landscape, the on-site target) and
 * 1280 / 1440 (the two desktop frames).
 *
 * Env: BASE, EMAIL, PASSWORD, OUT_DIR (default apps/web/.verify/configurator),
 * STEP (optional `?step=` passthrough is not supported — the surface owns its
 * step state, so the capture drives it by clicking the rail).
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "Capture-pass-123!";
const OUT_DIR = process.env.OUT_DIR ?? "apps/web/.verify/configurator";

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

// One authenticated context, reused across every viewport — the sign-in cookie
// is the expensive part and it is orthogonal to layout.
const context = await browser.newContext();
const signIn = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
  data: { email: EMAIL, password: PASSWORD },
});
if (!signIn.ok()) {
  console.error(`sign-in failed: ${signIn.status()} ${await signIn.text()}`);
  process.exit(1);
}
console.log("signed in");

for (const theme of ["light", "dark"]) {
  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`[${theme} ${vp.name}] ${String(e)}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`[${theme} ${vp.name}] console: ${m.text()}`);
    });
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // Drive dark the app's real way — seed the persisted preference so the
    // no-FOUC script and the theme store both resolve dark and put `.dark` on
    // <html> (the `@custom-variant dark` seam). Same technique as capture-brand.
    if (theme === "dark") {
      await page.addInitScript(() => {
        try {
          // eslint-disable-next-line no-undef -- runs in the browser
          localStorage.setItem("theme", "dark");
        } catch {
          /* pre-hydration: storage may be unavailable */
        }
      });
    }

    // NOT `networkidle`: the dev server's HMR socket and the Centrifugo
    // realtime connection are long-lived, so the network never goes idle and
    // the wait always times out. Wait for the surface's own content instead.
    await page.goto(`${BASE}/configurator`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page
      .locator("[data-slot='context-bar']")
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
    if (theme === "dark") {
      await page.evaluate(() => document.documentElement.classList.add("dark"));
    }
    // The derive runs on a worker, so the price/BOM arrive after first paint.
    // Wait for the SETTLED signal — a rendered price — not for the absence of
    // the "recalculating" string: the context bar keeps an `aria-hidden` ghost
    // copy of that text mounted permanently to reserve its layout slot, so the
    // string is in `body.textContent` forever and an absence check can never
    // pass. (A price-blind capture would need a different signal.)
    await page
      .waitForFunction(() => /\d[\d\s\u00a0]*,\d{2}\s*Kč/.test(document.body.textContent ?? ""), {
        timeout: 30_000,
      })
      .catch(() => errors.push(`[${theme} ${vp.name}] derive did not settle`));
    await page.evaluate(() => document.fonts.ready);

    // The ship bar's hard rule: the BODY must never scroll horizontally.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (overflow.scrollWidth > overflow.clientWidth) {
      errors.push(
        `[${theme} ${vp.name}] HORIZONTAL BODY SCROLL: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
      );
    }

    const out = `${OUT_DIR}/configurator-${vp.name}-${theme}.png`;
    await page.screenshot({ path: out });
    console.log(`captured ${out}`);
    await page.close();
  }
}

await browser.close();
if (errors.length) {
  console.log("\nISSUES:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("\nno page errors, no horizontal body scroll at any width");
}
