import { describe, expect, it } from "vitest";

import type { OrgRole } from "@repo/validators";

import { SETTINGS_TABS, visibleSettingsTabs } from "./settings-tabs";

/** The role × tab visibility matrix (1c-2 / design §4.3). Pinned so a future
 *  edit cannot leak the admin-only tabs (legalProfile/admin) to sales/workshop,
 *  or hide Účet/Zabezpečení from an org-less session. */
function keys(role: OrgRole | null): string[] {
  return visibleSettingsTabs({ role, isPlatformAdmin: false }).map((tab) => tab.key);
}

describe("SETTINGS_TABS", () => {
  it("registers the five known tabs in order", () => {
    expect(SETTINGS_TABS.map((t) => t.key)).toStrictEqual([
      "account",
      "security",
      "team",
      "legalProfile",
      "admin",
    ]);
  });
});

describe("visibleSettingsTabs", () => {
  it("an org-less / still-resolving session sees only Účet + Zabezpečení", () => {
    expect(keys(null)).toStrictEqual(["account", "security"]);
  });

  it("workshop reaches the team roster (read-only), never the admin-only tabs", () => {
    expect(keys("workshop")).toStrictEqual(["account", "security", "team"]);
  });

  it("sales sees the same set as workshop — the admin tabs stay hidden", () => {
    expect(keys("sales")).toStrictEqual(["account", "security", "team"]);
  });

  it("admin sees every tab, incl. Právní profil + Ceníky a verze", () => {
    expect(keys("admin")).toStrictEqual(["account", "security", "team", "legalProfile", "admin"]);
  });
});
