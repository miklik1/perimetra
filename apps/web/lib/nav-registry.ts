import { isActive, type Href, type RouteName } from "@repo/navigation";
import type { IconName } from "@repo/ui";
import type { OrgRole } from "@repo/validators";

/**
 * The authenticated app shell's role-aware surface registry (CAR-12, rewritten
 * for the ADR 0118 app shell / design/README.md §4). One entry per top-level
 * surface, each carrying its own visibility predicate, glyph, group and — from
 * 1c-3 — a count-pill source, so the three density renderers (SideRail /
 * IconRail / TabBar in components/app-shell) stay PURE consumers of
 * `visibleNavEntries`. That is what makes "the rail item set is invariant across
 * breakpoints — only density changes" (§4.4) enforceable rather than
 * aspirational: membership is decided here, once, for every rendering.
 *
 * Vocabulary and visibility mirror the roles model (§4.3, ADR 0056/0062):
 *  - `dashboard` (Přehled `/`) and `orders` (Zakázky) show to ANY org member.
 *  - `leads` (Poptávky, → /customers until the leads module lands), `quotes`
 *    (Nabídky) and `catalog` (Katalog, → /configurator) are the priced/
 *    commercial surfaces: `admin`/`sales` only. Workshop is deliberately
 *    excluded — a nabídka is constitutively priced and the configurator prices
 *    what it configures (workshop 403s on `/price-tables/active`), so routing
 *    workshop there is a dead end (§4.3).
 *  - `settings` (Nastavení) always shows once authenticated — even an org-less /
 *    still-resolving session (`role: null`) reaches its Účet/Zabezpečení tabs.
 *  - `platform` (Platforma) is gated by the platform/vendor operator flag, which
 *    is ORTHOGONAL to org role (ADR 0062) — a platform admin may hold any org
 *    role, or none yet while their own session resolves.
 */
export interface NavContext {
  role: OrgRole | null;
  isPlatformAdmin: boolean;
}

/** The vertical group an entry pins to: the scrollable main list, or the
 *  bottom-pinned footer (Platforma above Nastavení, §4.4). */
type NavGroup = "main" | "footer";

/**
 * Count-pill source — the `GET /v1/me/nav-counts` keys wired in 1c-3. Absent ⇒
 * no pill. `leads` is reserved but never emitted until the leads module exists:
 * an empty pill is worse than none (§4.1), so 1c-1 renders no pills at all.
 */
type NavCountKey = "leads" | "quotes" | "orders";

export interface NavEntry {
  /** i18n label key under the `nav` namespace (packages/i18n/src/messages/{cs,en}.ts). */
  key: "dashboard" | "leads" | "quotes" | "orders" | "catalog" | "settings" | "platform";
  to: Href;
  icon: IconName;
  group: NavGroup;
  countKey?: NavCountKey;
  /**
   * Extra routes whose paths ALSO mark this entry active — the section's child
   * surfaces that keep their own URL (§4.2). Nastavení owns /account,
   * /account/security, /team, /team/legal-profile and /admin, so being on any of
   * them highlights the one footer entry. Prefix-matched, so a parent route
   * covers its children (/account ⊇ /account/security).
   */
  activeMatch?: readonly RouteName[];
  show: (ctx: NavContext) => boolean;
}

// --- Visibility predicates (§4.3) --------------------------------------------
/** A resolved org member — any non-null role. */
const anyOrgMember = (ctx: NavContext): boolean => ctx.role !== null;
/** The priced/commercial surfaces: admin or sales, never workshop. */
const adminOrSales = (ctx: NavContext): boolean => ctx.role === "admin" || ctx.role === "sales";

export const NAV_ENTRIES: readonly NavEntry[] = [
  { key: "dashboard", to: { route: "home" }, icon: "layers", group: "main", show: anyOrgMember },
  { key: "leads", to: { route: "customers" }, icon: "post", group: "main", show: adminOrSales },
  {
    key: "quotes",
    to: { route: "quotes" },
    icon: "draft",
    group: "main",
    countKey: "quotes",
    // Nabídky owns two more framed routes that keep their own URL (§4.2): the
    // Rozpracované projects list and the /site/:projectId accumulator (a project
    // is a pre-issue quote). Prefix-matched, so /site/<id> is covered.
    activeMatch: ["projects", "site"],
    show: adminOrSales,
  },
  {
    key: "orders",
    to: { route: "orders" },
    icon: "list",
    group: "main",
    countKey: "orders",
    show: anyOrgMember,
  },
  {
    key: "catalog",
    to: { route: "configurator" },
    icon: "cube",
    group: "main",
    show: adminOrSales,
  },
  // Footer group — array order IS the top-to-bottom render order, and §4.4 pins
  // Platforma directly ABOVE Nastavení, so `platform` precedes `settings` here.
  {
    key: "platform",
    to: { route: "platform" },
    icon: "cube",
    group: "footer",
    show: (ctx) => ctx.isPlatformAdmin,
  },
  {
    key: "settings",
    // §4.1 points Nastavení at /settings — the tabbed section index (1c-2), which
    // redirects to its first tab (/account). Its sibling surfaces keep their own
    // URLs; `activeMatch` (prefix-matched) keeps the whole section highlighted on
    // any of them — /account ⊇ /account/security, /team ⊇ /team/legal-profile.
    to: { route: "settings" },
    icon: "scale",
    group: "footer",
    activeMatch: ["account", "team", "admin"],
    // Always visible once authenticated — even an org-less / still-resolving
    // session (role null) reaches its Účet/Zabezpečení tabs (§4.3).
    show: () => true,
  },
];

/** `NAV_ENTRIES` filtered for `ctx`, registry order preserved. */
export function visibleNavEntries(ctx: NavContext): readonly NavEntry[] {
  return NAV_ENTRIES.filter((entry) => entry.show(ctx));
}

/**
 * Is `entry` the active section for `pathname`? Its own route (prefix-matched,
 * so a detail screen keeps its parent lit) or any of its `activeMatch` child
 * routes. The root template `/` only matches bare `/` even in prefix mode
 * (`isActive`), so Přehled never lights on every route.
 */
export function isNavEntryActive(pathname: string, entry: NavEntry): boolean {
  if (isActive(pathname, entry.to.route, { exact: false })) return true;
  return entry.activeMatch?.some((route) => isActive(pathname, route, { exact: false })) ?? false;
}
