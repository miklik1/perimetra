// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ROUTE_SEGMENTS, type SegmentKind } from "./route-credential-manifest";

/**
 * The guard that makes `route-credential-manifest.ts` deny-by-default (ADR 0133).
 *
 * It reads the app directory tree OFF DISK rather than importing anything, for
 * the same reason `packages/telemetry/src/scrub.pii-contract.test.ts` reads the
 * schema source off disk: the thing being audited is a FILE LAYOUT, and the only
 * faithful reading of a file layout is the filesystem. A registry-based check
 * (e.g. `packages/navigation`'s `routes`) would be checking a hand-maintained
 * list against another hand-maintained list, which is drift measuring drift —
 * that registry is deliberately partial (sub-routes there use raw hrefs) and
 * carries phantom skeleton entries with no directory at all.
 *
 * Three assertions, all failing CLOSED:
 *   1. every discovered segment is declared  → a new route reds until judged;
 *   2. every declaration still exists        → the manifest cannot rot into fiction;
 *   3. the walk found something              → a moved app dir cannot make (1) vacuous.
 *
 * Plus a cross-check that a `credential: false` claim is backed by an actual
 * gate, so "not a credential" can never be asserted about a route nothing guards.
 */

const APP_DIR = fileURLToPath(new URL("./app", import.meta.url));
const PROXY_FILE = fileURLToPath(new URL("./proxy.ts", import.meta.url));
const REPO_PREFIX = "apps/web/app";

interface DiscoveredSegment {
  dir: string;
  segment: string;
  kind: SegmentKind;
  /** URL path with the dynamic parts left in — used only for the prefix check. */
  urlPath: string;
}

/**
 * Enumerate DIRECTORIES, never page files. `app/orders/[id]` has no `page.tsx`
 * of its own — only `production/` children — so a walker keyed on route files
 * would silently drop it and ship an 8-of-9 blind spot that still looks green.
 */
function discoverSegments(absolute: string, relative = ""): DiscoveredSegment[] {
  const found: DiscoveredSegment[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/.exec(entry.name);
    const catchAll = /^\[\.\.\.(.+)\]$/.exec(entry.name);
    const dynamic = /^\[(.+)\]$/.exec(entry.name);

    // Order matters: `[[...x]]` also matches the plain `[...]` and `[…]` forms,
    // so the most specific pattern has to be tested first or a future optional
    // catch-all is silently recorded as a plain dynamic segment.
    if (optionalCatchAll) {
      found.push({
        dir: `${REPO_PREFIX}/${childRelative}`,
        segment: optionalCatchAll[1]!,
        kind: "optional-catch-all",
        urlPath: `/${childRelative}`,
      });
    } else if (catchAll) {
      found.push({
        dir: `${REPO_PREFIX}/${childRelative}`,
        segment: catchAll[1]!,
        kind: "catch-all",
        urlPath: `/${childRelative}`,
      });
    } else if (dynamic) {
      found.push({
        dir: `${REPO_PREFIX}/${childRelative}`,
        segment: dynamic[1]!,
        kind: "dynamic",
        urlPath: `/${childRelative}`,
      });
    }
    found.push(...discoverSegments(join(absolute, entry.name), childRelative));
  }
  return found;
}

/**
 * The proxy's session-gate list, read from SOURCE. Importing `proxy.ts` would
 * drag in the real `@repo/config/env/web` and evaluate the whole env schema in a
 * test whose subject is a directory listing; `proxy.test.ts` mocks that module
 * wholesale for exactly this reason. A source read keeps the two suites
 * independent.
 */
function readProtectedPrefixes(): string[] {
  const source = readFileSync(PROXY_FILE, "utf8");
  const block = /const PROTECTED_PREFIXES = \[([^\]]*)\]/.exec(source);
  if (!block) throw new Error("PROTECTED_PREFIXES not found in proxy.ts");
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

const discovered = discoverSegments(APP_DIR);
const declaredByDir = new Map(ROUTE_SEGMENTS.map((entry) => [entry.dir, entry]));

describe("the route-segment credential manifest (ADR 0133)", () => {
  it("finds dynamic segments at all — the anti-vacuity guard", () => {
    // Without this, moving or renaming `app/` turns every assertion below into a
    // loop over an empty list and the guard passes while auditing nothing.
    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered.map((s) => s.dir)).toContain("apps/web/app/accept-invitation/[invitationId]");
  });

  it("declares EVERY dynamic route segment — an undeclared one fails closed", () => {
    const undeclared = discovered.filter((s) => !declaredByDir.has(s.dir)).map((s) => s.dir);
    expect(
      undeclared,
      `Undeclared dynamic route segment(s). Add a row to apps/web/route-credential-manifest.ts ` +
        `declaring whether the segment's VALUE is a bearer credential — i.e. whether possession ` +
        `of the URL is itself the authorisation. This fails closed on purpose (ADR 0133): a ` +
        `credential-bearing route must never be able to opt out of the audit silently.`,
    ).toEqual([]);
  });

  it("declares nothing that no longer exists — the manifest cannot rot into fiction", () => {
    const discoveredDirs = new Set(discovered.map((s) => s.dir));
    const stale = ROUTE_SEGMENTS.filter((entry) => !discoveredDirs.has(entry.dir)).map(
      (entry) => entry.dir,
    );
    expect(stale, "Stale manifest row(s) — the directory is gone. Delete the row.").toEqual([]);
  });

  it("records each segment's name and kind correctly", () => {
    for (const segment of discovered) {
      const declaration = declaredByDir.get(segment.dir);
      expect(declaration, segment.dir).toBeDefined();
      expect(declaration!.segment, segment.dir).toBe(segment.segment);
      expect(declaration!.kind, segment.dir).toBe(segment.kind);
    }
  });

  it("backs every non-credential claim with a real gate", () => {
    const prefixes = readProtectedPrefixes();
    expect(prefixes.length, "PROTECTED_PREFIXES parsed empty").toBeGreaterThan(0);

    for (const entry of ROUTE_SEGMENTS) {
      if (entry.credential) continue;
      const urlPath = entry.dir.slice(REPO_PREFIX.length);
      const proxyGated = prefixes.some((prefix) => urlPath.startsWith(prefix));
      if (proxyGated) {
        expect(entry.gatedBy, entry.dir).toBe("proxy");
      } else {
        // Outside the proxy gate, "not a credential" is only true if something
        // ELSE refuses the request. `/platform/releases/drafts/[id]` is the live
        // case: no proxy prefix, no layout gate, guarded server-side instead —
        // so the manifest has to say so and name the guard in its reason.
        expect(
          entry.gatedBy,
          `${entry.dir} is outside PROTECTED_PREFIXES, so it cannot claim a proxy gate`,
        ).toBe("api");
        expect(entry.reason.length, entry.dir).toBeGreaterThan(40);
      }
    }
  });

  it("keeps a credential-bearing route out of any path-preserving telemetry sink by construction", () => {
    // The standing claim of ADR 0130: no credential-bearing segment may be
    // reachable as a PAGE route, because a page URL is what reaches Sentry and
    // PostHog. `/api/[...path]` is exempt — it is a route handler, never a
    // navigated URL — and `accept-invitation` is the acknowledged exception,
    // whose id is necessary-but-not-sufficient. Anything NEW that is both
    // credential-bearing and page-routed has to be argued for here, in review.
    const pageRoutedCredentials = ROUTE_SEGMENTS.filter(
      (entry) => entry.credential && !entry.dir.startsWith("apps/web/app/api/"),
    ).map((entry) => entry.dir);
    expect(pageRoutedCredentials).toEqual(["apps/web/app/accept-invitation/[invitationId]"]);
  });
});
