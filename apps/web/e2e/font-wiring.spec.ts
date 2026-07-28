import { expect, test } from "@playwright/test";

/**
 * The ADR 0139 regression guard: the brand faces actually reach the glass.
 *
 * WHY THIS SPEC IS SHAPED THE WAY IT IS. The obvious test — assert the four
 * next/font `.variable` classes sit on the right element — is exactly the test
 * that would have stayed green for the three months `--font-mono` rendered
 * nothing. The classes were present the whole time; they were present on the
 * WRONG element, and a class-name assertion cannot tell the difference. So this
 * spec never looks at a class. It reads the RESOLVED chain, then measures what
 * that chain actually rasterises.
 *
 * Runs on `/login`, the only primary surface needing no session, so the
 * hermetic (mock-mode) suite can carry it.
 */

/**
 * Measure one string at each of the given font-family chains, in page context.
 * Returned in the same order as `families`. Kept as a single `evaluate` with the
 * helper declared INSIDE it: the page ships a strict nonce-based CSP with no
 * `unsafe-eval`, so reconstructing a function from a string in page context
 * would be blocked.
 */
async function widths(page: import("@playwright/test").Page, families: readonly string[]) {
  return page.evaluate((chains) => {
    const measure = (ff: string) => {
      const el = document.createElement("span");
      el.textContent = "Hamburgefonstiv 0123456789 příliš žluťoučký kůň";
      el.style.cssText = `position:absolute;left:-9999px;white-space:nowrap;font-size:64px;font-family:${ff};`;
      document.body.appendChild(el);
      const w = el.getBoundingClientRect().width;
      el.remove();
      return w;
    };
    return chains.map(measure);
  }, families);
}

/** The resolved value of a custom property at `:root` — where `@theme` puts the tokens. */
const tokenAtRoot = (page: import("@playwright/test").Page, token: string) =>
  page.evaluate(
    (t) => getComputedStyle(document.documentElement).getPropertyValue(t).trim(),
    token,
  );

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  // The variable woff2 files must be swapped in before anything is measured;
  // `display: "swap"` means an early read would measure the fallback face.
  await page.evaluate(() => document.fonts.ready);
});

/**
 * THE SCOPE PIN. `@theme` emits the role tokens at `:root`, and a `var()` inside
 * a custom-property declaration is substituted on the DECLARING element — so the
 * next/font variables must be readable AT `:root`, or every token silently takes
 * its fallback arm. Move the classes back to <body> and this reds first.
 */
test("the next/font variables are in scope at :root, where the tokens are declared", async ({
  page,
}) => {
  const atRoot = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ["--font-synonym", "--font-chillax", "--font-amulya", "--font-geist-mono"].map((v) => [
        v,
        s.getPropertyValue(v).trim(),
      ]),
    );
  });

  for (const [variable, value] of Object.entries(atRoot)) {
    expect(value, `${variable} must be readable at :root, not one element below it`).not.toBe("");
  }
});

/**
 * THE RENDERING PIN. Each role token must rasterise as its intended face and NOT
 * as the platform stack. Comparing widths against a control rather than
 * asserting a family NAME is deliberate: the `font-family` string differs
 * between the working and broken wiring in ways that do not move a single pixel
 * (`"Synonym"` and `synonym` are the same face — CSS family names are ASCII
 * case-insensitive), which is exactly how the broken wiring was once
 * mis-diagnosed as "every surface renders the OS font".
 */
const ROLES = [
  { token: "--font-sans", face: "synonym", generic: "sans-serif" },
  { token: "--font-display", face: "chillax", generic: "sans-serif" },
  { token: "--font-data", face: "amulya", generic: "sans-serif" },
  // `--font-mono` is the one role the ADR 0139 accident did NOT rescue: its
  // fallback arm was the generic `ui-monospace`, carrying no family name for a
  // case-insensitive match to land on, so Geist Mono never rendered at all while
  // its woff2 was preloaded on every page.
  { token: "--font-mono", face: "geistMono", generic: "ui-monospace" },
] as const;

for (const { token, face, generic } of ROLES) {
  test(`${token} rasterises as ${face}, not as ${generic}`, async ({ page }) => {
    const chain = await tokenAtRoot(page, token);
    expect(chain, `${token} must resolve to something`).not.toBe("");

    const [viaToken, viaFace, viaGeneric] = await widths(page, [chain, face, generic]);

    expect(viaToken, `${token} must rasterise as ${face}`).toBeCloseTo(viaFace!, 1);
    expect(
      Math.abs(viaToken! - viaGeneric!),
      `${token} must not be falling through to ${generic}`,
    ).toBeGreaterThan(1);
  });
}
