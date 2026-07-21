import { describe, expect, it } from "vitest";

import type { OrgRole } from "@repo/validators";

import { isNavEntryActive, NAV_ENTRIES, visibleNavEntries } from "./nav-registry";

/**
 * The full role × platform-admin visibility matrix (CAR-12 / ADR 0118 §4.3).
 * Every combo is pinned so a future registry edit can't silently leak
 * `catalog`/`platform` to `workshop`, or hide `settings` from an org-less
 * session.
 */
function keys(role: OrgRole | null, isPlatformAdmin: boolean): string[] {
  return visibleNavEntries({ role, isPlatformAdmin }).map((entry) => entry.key);
}

describe("NAV_ENTRIES", () => {
  it("registers exactly the 7 known surfaces in §4.1 order, each with a unique key", () => {
    expect(NAV_ENTRIES.map((e) => e.key)).toStrictEqual([
      "dashboard",
      "leads",
      "quotes",
      "orders",
      "catalog",
      "platform",
      "settings",
    ]);
  });

  it("groups the two footer surfaces (Platforma above Nastavení), the rest main", () => {
    const groups = Object.fromEntries(NAV_ENTRIES.map((e) => [e.key, e.group]));
    expect(groups).toStrictEqual({
      dashboard: "main",
      leads: "main",
      quotes: "main",
      orders: "main",
      catalog: "main",
      platform: "footer",
      settings: "footer",
    });
  });

  it("declares count-pill sources only on quotes + orders (leads stays pill-less until its module lands)", () => {
    const withCounts = NAV_ENTRIES.filter((e) => e.countKey).map((e) => [e.key, e.countKey]);
    expect(withCounts).toStrictEqual([
      ["quotes", "quotes"],
      ["orders", "orders"],
    ]);
  });
});

describe("visibleNavEntries", () => {
  it("an org-less / still-resolving session sees only Nastavení", () => {
    expect(keys(null, false)).toStrictEqual(["settings"]);
  });

  it("an org-less session that IS the platform operator sees Platforma + Nastavení", () => {
    expect(keys(null, true)).toStrictEqual(["platform", "settings"]);
  });

  it("admin sees every main surface + Nastavení, minus Platforma (not the operator)", () => {
    expect(keys("admin", false)).toStrictEqual([
      "dashboard",
      "leads",
      "quotes",
      "orders",
      "catalog",
      "settings",
    ]);
  });

  it("admin who is ALSO the platform operator sees everything", () => {
    expect(keys("admin", true)).toStrictEqual([
      "dashboard",
      "leads",
      "quotes",
      "orders",
      "catalog",
      "platform",
      "settings",
    ]);
  });

  it("sales sees the same top-level set as admin (tab-level divergence is inside Nastavení)", () => {
    expect(keys("sales", false)).toStrictEqual([
      "dashboard",
      "leads",
      "quotes",
      "orders",
      "catalog",
      "settings",
    ]);
  });

  it("workshop (price-blind) loses Poptávky/Nabídky/Katalog, keeps Přehled/Zakázky/Nastavení", () => {
    expect(keys("workshop", false)).toStrictEqual(["dashboard", "orders", "settings"]);
  });

  it("workshop must NOT gain the priced surfaces even as the platform operator's own org role", () => {
    const visible = keys("workshop", true);
    expect(visible).not.toContain("leads");
    expect(visible).not.toContain("quotes");
    expect(visible).not.toContain("catalog");
    // `platform` is orthogonal to org role (ADR 0062) — the flag alone gates it.
    expect(visible).toContain("platform");
    expect(visible).toStrictEqual(["dashboard", "orders", "platform", "settings"]);
  });
});

describe("isNavEntryActive", () => {
  const entry = (key: string) => NAV_ENTRIES.find((e) => e.key === key)!;

  it("prefix-matches a surface's own route, so a detail screen keeps its section lit", () => {
    expect(isNavEntryActive("/orders", entry("orders"))).toBe(true);
    expect(isNavEntryActive("/orders/abc/production", entry("orders"))).toBe(true);
    expect(isNavEntryActive("/quotes", entry("orders"))).toBe(false);
  });

  it("lights Přehled only on bare / (the root never prefix-matches every route)", () => {
    expect(isNavEntryActive("/", entry("dashboard"))).toBe(true);
    expect(isNavEntryActive("/orders", entry("dashboard"))).toBe(false);
  });

  it("lights Nabídky across its child sections (/projects, /site/:id) via activeMatch", () => {
    const quotes = entry("quotes");
    expect(isNavEntryActive("/quotes", quotes)).toBe(true);
    expect(isNavEntryActive("/quotes/q1", quotes)).toBe(true);
    expect(isNavEntryActive("/projects", quotes)).toBe(true);
    expect(isNavEntryActive("/site/abc", quotes)).toBe(true);
    expect(isNavEntryActive("/orders", quotes)).toBe(false);
  });

  it("lights Nastavení across all its child sections via activeMatch", () => {
    const settings = entry("settings");
    expect(isNavEntryActive("/account", settings)).toBe(true);
    expect(isNavEntryActive("/account/security", settings)).toBe(true);
    expect(isNavEntryActive("/team", settings)).toBe(true);
    expect(isNavEntryActive("/team/legal-profile", settings)).toBe(true);
    expect(isNavEntryActive("/admin", settings)).toBe(true);
    expect(isNavEntryActive("/orders", settings)).toBe(false);
  });
});
