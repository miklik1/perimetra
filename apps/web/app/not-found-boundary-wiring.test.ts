// @vitest-environment node
// (walks the app/ router tree off disk via import.meta.url → needs a real
// file:// URL, which the default jsdom environment does not provide.)
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WHY THIS TEST EXISTS (ADR 1037).
 *
 * `notFound()` sets a 404 by throwing while the response is still uncommitted.
 * A `loading.tsx` is sugar for a `<Suspense>` boundary wrapped around its
 * segment AND everything below it; flushing a shell through that boundary puts
 * the HTTP status line on the wire at 200, and a `notFound()` reached
 * afterwards can no longer change it. The app then serves 404 markup under a
 * 200 — an indexable soft-404 that looks completely correct in a browser.
 *
 * ADR 1037 measured this three ways: a root `loading.tsx`, a hand-written
 * `<Suspense>` in a layout, and a `loading.tsx` in the call site's OWN segment
 * all produced 200. So the rule is not "no root loading.tsx" — it is "no
 * boundary at or above a `notFound()` call site", and it is inherent to React
 * streaming rather than a Next quirk that a release will fix.
 *
 * WHAT THE REST OF THE SUITE COULD NOT DO. The e2e assertion measures exactly
 * one call site — the `/not-found-probe` fixture at the app root, where no
 * ancestor boundary exists — so it is structurally incapable of catching a new
 * `notFound()` added UNDER a boundary someone introduces later. Add a
 * `loading.tsx` to any segment above one, and that route soft-404s while the
 * whole suite stays green. That gap is what this file closes.
 *
 * PERIMETRA'S SITUATION WHEN THIS ARRIVED (W16 drain, ADR 0138) was the reason
 * the guard mattered more here than upstream. The skeleton shipped the CAUSE
 * with zero `notFound()` call sites, so its defect was latent. Perimetra had
 * NINE real call sites — `/site/[projectId]`, `/quotes/[id]/nabidka`, the two
 * `production/traveler` routes, `/invoices/[id]/faktura`,
 * `/platform/releases/drafts/[id]`, and the three prod-gated lab routes — and
 * a single root `app/loading.tsx` sitting above all of them, so every one was
 * serving 404 markup under a 200. Deleting that file took the offender count
 * from nine to zero, and perimetra now ships NO Suspense boundary in its router
 * tree at all. This guard's job here is to keep it that way: the highest-risk
 * future move is a segment-level `loading.tsx` on `/quotes`, `/orders`,
 * `/invoices`, `/site` or `/platform`, each of which has a call site beneath it.
 *
 * WHAT IT DELIBERATELY CANNOT PROVE. This is a SOURCE / FILE-TREE contract
 * test, not a status assertion. It reasons about router segments on disk, so it
 * cannot see a `<Suspense>` written inline in a page's own JSX above an
 * imported child that calls `notFound()`, and it cannot see a boundary
 * introduced by a third-party provider component. Those remain the e2e
 * assertion's job (`e2e/not-found.spec.ts`), which measures the property —
 * the HTTP status — instead of the syntax. The two are complementary: this one
 * is cheap, runs on every unit run, and scales to every call site in the tree;
 * that one is exact and covers shapes no file walk can see.
 */

const APP_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO_ROOT = resolve(APP_DIR, "../../..");
const rel = (abs: string) => relative(REPO_ROOT, abs).split(sep).join("/");

/**
 * Strips comments before matching. Every file in this rule documents the rule,
 * quoting `notFound()` almost verbatim — without this, the two `loading.tsx`
 * doc-comments would register as call sites under their own boundary and the
 * guard would fail on its own prose. The `[^:"'`\\]` guard keeps `https://`
 * inside a string from eating the rest of the line.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

/** A `loading.tsx` in a segment directory — the boundary in its sugared form. */
const LOADING_FILE = /^loading\.[jt]sx?$/;
/** A layout/template is the other place a boundary is written by hand. */
const WRAPPER_FILE = /^(layout|template)\.[jt]sx?$/;
const SOURCE_FILE = /\.[jt]sx?$/;
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
/**
 * Route handlers are excluded: they return a Response rather than rendering
 * into the streamed RSC tree, so a `loading.tsx` never wraps one.
 */
const ROUTE_HANDLER = /^route\.[jt]sx?$/;
const NOT_FOUND_CALL = /\bnotFound\s*\(\s*\)/;

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

/** Every Suspense boundary declared directly in one segment directory. */
function boundariesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (LOADING_FILE.test(entry.name)) {
      found.push(join(dir, entry.name));
    } else if (WRAPPER_FILE.test(entry.name)) {
      if (/<Suspense[\s/>]/.test(code(readFileSync(join(dir, entry.name), "utf8")))) {
        found.push(join(dir, entry.name));
      }
    }
  }
  return found;
}

/**
 * The call site's own segment first, then every ancestor up to `app/`. The own
 * segment is included because ADR 1037's measurement 4 showed a `loading.tsx`
 * soft-404s the page sitting beside it, not only the ones below it.
 */
function segmentsAtOrAbove(file: string): string[] {
  const chain: string[] = [];
  for (let dir = dirname(file); dir.startsWith(APP_DIR); dir = dirname(dir)) {
    chain.push(dir);
    if (dir === APP_DIR) break;
  }
  return chain;
}

const callSites = [...walkFiles(APP_DIR)].filter((file) => {
  const name = basename(file);
  if (!SOURCE_FILE.test(name) || TEST_FILE.test(name) || ROUTE_HANDLER.test(name)) return false;
  return NOT_FOUND_CALL.test(code(readFileSync(file, "utf8")));
});

const RULE = [
  "ADR 1037 — no Suspense boundary may sit above (or beside) a `notFound()` call site.",
  "",
  "A `loading.tsx` IS a <Suspense> boundary wrapped around its segment and everything below it.",
  "Once React flushes a shell through that boundary the HTTP status is already 200 on the wire, so",
  "a `notFound()` reached afterwards cannot set 404: the route serves 404 MARKUP UNDER A 200 — an",
  "indexable soft-404 that is invisible in a browser, because the page still looks like a 404 page.",
  "",
  "Fix ONE of these:",
  "  1. move the boundary DOWN to the leaf that actually fetches, below the `notFound()` call site;",
  "  2. move the `notFound()` call site OUT of that subtree — a sibling segment or its own route",
  "     group (`app/(group)/`) gives it an uncommitted response again; or",
  "  3. delete the boundary. A shell flush is a rendering nicety; a 404 status is a correctness",
  "     property, and the crawler that reads the 200 keeps the error page in the index.",
  "",
  "Offenders — call site, then the boundary that commits the response above it:",
  "",
].join("\n");

describe("no Suspense boundary sits above a notFound() call site", () => {
  it("finds at least one notFound() call site, so the guard below is not vacuous", () => {
    // A file walk that matches nothing passes forever. Perimetra has nine real
    // domain call sites plus the `app/not-found-probe/` fixture, so this cannot
    // go vacuous by accident today — but the invariant is deliberately "at least
    // one", not "this exact path", so a refactor that relocates every one of
    // them still has to keep the guard armed.
    expect(callSites.map(rel)).not.toHaveLength(0);
  });

  it("keeps every notFound() call site out from under a Suspense boundary", () => {
    const offenders = callSites.flatMap((file) =>
      segmentsAtOrAbove(file).flatMap((dir) =>
        boundariesIn(dir).map((boundary) => `  ${rel(file)}\n    ↳ boundary: ${rel(boundary)}`),
      ),
    );

    // The rule travels with the failure: a contributor who trips this has
    // almost certainly never read ADR 1037, and the symptom they would see
    // without it — a 404 page that looks perfectly fine — explains nothing.
    expect(offenders.length === 0 ? "" : RULE + offenders.join("\n")).toBe("");
  });

  it("keeps loading.tsx off the app root, where the boundary spans every route", () => {
    // Implied by the guard above while a call site exists at the root, but
    // asserted directly so the highest-cost shape of the defect — one file that
    // soft-404s every present and future `notFound()` in the app at once — is
    // named rather than inferred.
    const rootFiles = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    expect(rootFiles.filter((name) => LOADING_FILE.test(name))).toEqual([]);
  });
});
