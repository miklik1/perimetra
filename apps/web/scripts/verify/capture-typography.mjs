/**
 * Headless typography capture — the eyes for the ADR 0078 brand trio actually
 * rendering (ADR 0139). Runs the SAME pass twice, once per tree state, and writes
 * into a LABEL-named directory so the pairs sit side by side for a flip-through:
 *
 *   LABEL=before  # on the tree where the tokens still resolve to the OS font
 *   LABEL=after   # on the fixed tree
 *
 * Beyond the screenshots it records the RESOLVED font chain — `getComputedStyle`
 * on one representative element per role, plus `document.fonts.check()` against
 * the resolved first family. That measurement, not a class-name assertion, is
 * what proves the faces are live: a class name was present the whole time the
 * product rendered in the system font.
 *
 *   BASE=http://localhost:3002 EMAIL=admin@perimetra.local PASSWORD=... \
 *     LABEL=before node apps/web/scripts/verify/capture-typography.mjs
 *
 * Env: BASE, EMAIL (required), PASSWORD, LABEL (default "current"),
 *      OUT_DIR (default apps/web/.verify/typography/<LABEL>), THEME (one theme only).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3002";
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD ?? "perimetra-dev-2026";
const LABEL = process.env.LABEL ?? "current";
const OUT_DIR = process.env.OUT_DIR ?? `apps/web/.verify/typography/${LABEL}`;

if (!EMAIL) {
  console.error("EMAIL is required");
  process.exit(1);
}
await mkdir(OUT_DIR, { recursive: true });

/**
 * The primary surfaces. `auth:false` entries are captured in a clean context so
 * the unauthenticated chrome is covered too. `wait` is a selector that must be
 * visible before the shot — a full-page screenshot of a skeleton proves nothing.
 */
const SURFACES = [
  { name: "brand-lab", path: "/brand-lab", wait: "[data-slot='brand-lab']" },
  { name: "login", path: "/login", auth: false, wait: "form" },
  { name: "dashboard", path: "/", wait: "main" },
  { name: "projects", path: "/projects", wait: "main" },
  { name: "quotes", path: "/quotes", wait: "main" },
  { name: "orders", path: "/orders", wait: "main" },
  { name: "customers", path: "/customers", wait: "main" },
  { name: "configurator", path: "/configurator", wait: "main" },
  { name: "account", path: "/account", wait: "main" },
];

const THEMES = process.env.THEME ? [process.env.THEME] : ["light", "dark"];

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

/**
 * The measurement. Reads the token values off `:root` (which is where Tailwind's
 * `@theme` puts them — the whole substitution bug lives in that scope), then the
 * COMPUTED family of a real element per role, then asks the font loader whether
 * the resolved first family is actually available. A chain that names a family
 * the document never minted reports `loaded:false` here while still looking
 * plausible in the CSS.
 */
const measure = () =>
  ((doc, win) => {
    const root = doc.documentElement;
    const rootStyle = win.getComputedStyle(root);
    const tokens = Object.fromEntries(
      ["--font-sans", "--font-display", "--font-data", "--font-mono"].map((t) => [
        t,
        rootStyle.getPropertyValue(t).trim(),
      ]),
    );
    // The next/font variables themselves — reported at BOTH scopes, because the
    // defect is precisely that they were readable at <body> and not at :root.
    const frameworkVars = {};
    for (const v of ["--font-synonym", "--font-chillax", "--font-amulya", "--font-geist-mono"]) {
      frameworkVars[v] = {
        atRoot: rootStyle.getPropertyValue(v).trim(),
        atBody: win.getComputedStyle(doc.body).getPropertyValue(v).trim(),
      };
    }
    const firstFamily = (chain) => (chain.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
    const roleOf = (sel, role) => {
      const el = doc.querySelector(sel);
      if (!el) return { role, selector: sel, present: false };
      const family = win.getComputedStyle(el).fontFamily;
      const first = firstFamily(family);
      let loaded = false;
      try {
        loaded = doc.fonts.check(`16px "${first}"`);
      } catch {
        loaded = false;
      }
      return { role, selector: sel, present: true, family, first, loaded };
    };
    return {
      tokens,
      frameworkVars,
      roles: [
        roleOf("body", "sans/body"),
        roleOf("h1, h2, h3", "display/heading"),
        roleOf("[class*='font-data']", "data"),
        roleOf("[class*='font-mono']", "mono"),
      ],
      // Every family the document actually loaded — the ground truth.
      loadedFaces: [...doc.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`).sort(),
    };
  })(document, window);

const report = { label: LABEL, base: BASE, capturedAt: new Date().toISOString(), surfaces: [] };

for (const theme of THEMES) {
  for (const surface of SURFACES) {
    const context = await browser.newContext({
      colorScheme: theme,
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      ...(surface.auth === false ? {} : { storageState }),
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`[${theme} ${surface.name}] ${String(e)}`));
    // Preference seeded to `system` so ThemeEffect reads the context's emulated
    // scheme instead of a persisted override (the capture-brand precedent — a
    // localStorage `theme=dark` seed RACES ThemeEffect and shoots light).
    await page.addInitScript(() => {
      try {
        // eslint-disable-next-line no-undef -- runs in the browser via addInitScript
        localStorage.setItem("theme", "system");
      } catch {
        /* pre-hydration: storage may be unavailable */
      }
    });
    try {
      await page.goto(`${BASE}${surface.path}`, { waitUntil: "networkidle", timeout: 90_000 });
      await page
        .locator(surface.wait)
        .first()
        .waitFor({ state: "visible", timeout: 30_000 })
        .catch(() => errors.push(`[${theme} ${surface.name}] wait selector never appeared`));
      await page
        .waitForFunction(
          (t) => document.documentElement.classList.contains("dark") === (t === "dark"),
          theme,
          { timeout: 10_000 },
        )
        .catch(() => errors.push(`[${theme} ${surface.name}] theme did not resolve to ${theme}`));
      await page.evaluate(() => document.fonts.ready);
      const out = `${OUT_DIR}/${surface.name}-${theme}.png`;
      await page.screenshot({ path: out, fullPage: true });
      if (theme === THEMES[0]) {
        report.surfaces.push({ surface: surface.name, theme, ...(await page.evaluate(measure)) });
      }
      console.log(`captured ${out}`);
    } catch (e) {
      errors.push(`[${theme} ${surface.name}] ${String(e)}`);
    }
    await context.close();
  }
}

await browser.close();
report.errors = errors;
await writeFile(`${OUT_DIR}/font-chain.json`, JSON.stringify(report, null, 2));
console.log(`\nmeasurement → ${OUT_DIR}/font-chain.json`);
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
