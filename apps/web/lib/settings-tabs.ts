import type { Href } from "@repo/navigation";

import type { NavContext } from "./nav-registry";

/**
 * The Nastavení section index (1c-2, design/README.md §4.1). One tab per absorbed
 * surface; each keeps its OWN url (`/account`, `/account/security`, `/team`,
 * `/team/legal-profile`, `/admin`) and renders the shared strip — no route moved,
 * no redirect off the tab. Role-gated here, once, so the tab strip can never
 * offer a surface the caller cannot open (the same single-source discipline as
 * `nav-registry.ts`; the server still enforces on every route).
 *
 *  - `account` / `security` — always, even an org-less (role null) session.
 *  - `team` — any resolved org member (a non-admin sees a read-only roster).
 *  - `legalProfile` / `admin` — admin only (the server 403s the others).
 */
export type SettingsTabKey = "account" | "security" | "team" | "legalProfile" | "admin";

export interface SettingsTab {
  key: SettingsTabKey;
  to: Href;
  show: (ctx: NavContext) => boolean;
}

const anyOrgMember = (ctx: NavContext): boolean => ctx.role !== null;
const adminOnly = (ctx: NavContext): boolean => ctx.role === "admin";

export const SETTINGS_TABS: readonly SettingsTab[] = [
  { key: "account", to: { route: "account" }, show: () => true },
  { key: "security", to: { route: "accountSecurity" }, show: () => true },
  { key: "team", to: { route: "team" }, show: anyOrgMember },
  { key: "legalProfile", to: { route: "legalProfile" }, show: adminOnly },
  { key: "admin", to: { route: "admin" }, show: adminOnly },
];

/** `SETTINGS_TABS` filtered for `ctx`, registry order preserved. */
export function visibleSettingsTabs(ctx: NavContext): readonly SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => tab.show(ctx));
}
