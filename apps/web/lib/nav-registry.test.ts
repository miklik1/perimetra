import { describe, expect, it } from "vitest";

import type { OrgRole } from "@repo/validators";

import { NAV_ENTRIES, visibleNavEntries } from "./nav-registry";

/**
 * The full role × platform-admin visibility matrix (CAR-12). Every combo is
 * pinned so a future registry edit can't silently leak `admin`/`platform` to
 * `workshop`, or hide `account` from an org-less session.
 */
function keys(role: OrgRole | null, isPlatformAdmin: boolean): string[] {
  return visibleNavEntries({ role, isPlatformAdmin }).map((entry) => entry.key);
}

describe("visibleNavEntries", () => {
  it("registers exactly the 7 known surfaces, each with a unique key", () => {
    expect(NAV_ENTRIES.map((e) => e.key)).toStrictEqual([
      "configurator",
      "projects",
      "quotes",
      "team",
      "admin",
      "platform",
      "account",
    ]);
  });

  it("an org-less/still-resolving session sees only account", () => {
    expect(keys(null, false)).toStrictEqual(["account"]);
  });

  it("an org-less session that IS the platform operator sees platform + account", () => {
    expect(keys(null, true)).toStrictEqual(["platform", "account"]);
  });

  it("admin sees every product surface plus admin, minus platform (not the operator)", () => {
    expect(keys("admin", false)).toStrictEqual([
      "configurator",
      "projects",
      "quotes",
      "team",
      "admin",
      "account",
    ]);
  });

  it("admin who is ALSO the platform operator sees everything", () => {
    expect(keys("admin", true)).toStrictEqual([
      "configurator",
      "projects",
      "quotes",
      "team",
      "admin",
      "platform",
      "account",
    ]);
  });

  it("sales sees the product surfaces + team, never admin", () => {
    expect(keys("sales", false)).toStrictEqual([
      "configurator",
      "projects",
      "quotes",
      "team",
      "account",
    ]);
  });

  it("sales who is ALSO the platform operator gains platform, still never admin", () => {
    expect(keys("sales", true)).toStrictEqual([
      "configurator",
      "projects",
      "quotes",
      "team",
      "platform",
      "account",
    ]);
  });

  it("workshop (price-blind) sees the product surfaces + team, never admin or platform", () => {
    expect(keys("workshop", false)).toStrictEqual([
      "configurator",
      "projects",
      "quotes",
      "team",
      "account",
    ]);
  });

  it("workshop must NOT see admin/platform even as the platform operator's own org role", () => {
    const visible = keys("workshop", true);
    expect(visible).not.toContain("admin");
    // `platform` is orthogonal to org role (ADR 0062) — the flag alone gates it.
    expect(visible).toContain("platform");
  });
});
