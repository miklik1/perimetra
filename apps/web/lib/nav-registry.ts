import type { Href } from "@repo/navigation";
import type { OrgRole } from "@repo/validators";

/**
 * The persistent nav shell's role-aware surface registry (CAR-12): one entry
 * per top-level app surface, each carrying its own visibility predicate so
 * `NavShell` (components/nav-shell.tsx) stays a pure renderer over this list —
 * adding/removing a surface is a one-line registry edit, never a shell change.
 *
 * Visibility mirrors the roles model (ADR 0056/0062):
 *  - `configurator` / `projects` / `quotes` / `team` are visible to ANY org
 *    member (a resolved `role`). `quotes` is price-BEARING, but workshop's
 *    price-blindness (`usePriceBlind`) is enforced INSIDE the surface, not by
 *    hiding the nav link — a workshop user can still open a quote to see its
 *    geometry/specs, just not its price.
 *  - `customers` (ADR 0082/CAR-23) needs `admin` or `sales` — workshop is a
 *    hard 403 on the whole `CustomersController` (price-blind, no buyer PII),
 *    so unlike `quotes` the nav link itself is hidden, not just the surface's
 *    internals.
 *  - `admin` needs the org `admin` role (`/admin` — price tables).
 *  - `platform` needs the platform/vendor operator flag, which is ORTHOGONAL
 *    to org role (ADR 0062) — a platform admin may hold any org role, or none
 *    yet while their own session is still resolving.
 *  - `account` always shows once authenticated: the shell itself gates on
 *    `isAuthenticated` before consulting this registry, so an org-less/still-
 *    resolving session (`role: null`, not a platform admin) still resolves to
 *    `account` alone — never an empty shell for a signed-in visitor.
 */
export interface NavContext {
  role: OrgRole | null;
  isPlatformAdmin: boolean;
}

export interface NavEntry {
  /** i18n label key under the `nav` namespace (packages/i18n/src/messages/{cs,en}.ts). */
  key:
    | "configurator"
    | "projects"
    | "quotes"
    | "customers"
    | "team"
    | "admin"
    | "platform"
    | "account";
  to: Href;
  show: (ctx: NavContext) => boolean;
}

const anyOrgMember = (ctx: NavContext): boolean => ctx.role !== null;
const canManageCustomers = (ctx: NavContext): boolean =>
  ctx.role === "admin" || ctx.role === "sales";

export const NAV_ENTRIES: readonly NavEntry[] = [
  { key: "configurator", to: { route: "configurator" }, show: anyOrgMember },
  { key: "projects", to: { route: "projects" }, show: anyOrgMember },
  { key: "quotes", to: { route: "quotes" }, show: anyOrgMember },
  { key: "customers", to: { route: "customers" }, show: canManageCustomers },
  { key: "team", to: { route: "team" }, show: anyOrgMember },
  { key: "admin", to: { route: "admin" }, show: (ctx) => ctx.role === "admin" },
  { key: "platform", to: { route: "platform" }, show: (ctx) => ctx.isPlatformAdmin },
  { key: "account", to: { route: "account" }, show: () => true },
];

/** `NAV_ENTRIES` filtered for `ctx`, registry order preserved. */
export function visibleNavEntries(ctx: NavContext): readonly NavEntry[] {
  return NAV_ENTRIES.filter((entry) => entry.show(ctx));
}
