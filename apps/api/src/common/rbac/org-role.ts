/**
 * Membership-scoped RBAC roles (ADR 0056). The role is a property of a `member`
 * row — a user WITHIN one organization — NOT a global `users.role` column. This
 * is deliberately the inverse of Anyora's "no role enum" rule: that bans a
 * GLOBAL role on the user; a role scoped to one membership is the correct shape
 * for per-tenant authz (the same user can be `admin` of their own org and, once
 * the invite slice lands, `sales` of another).
 *
 * The wire/UI mirror of these strings lives in `@repo/validators` (`orgRoleSchema`,
 * consumed by the FE + the `/me` query). Kept as a tiny local tuple here so the
 * api's authz core carries no cross-package import for three stable literals —
 * the two lists are intentionally identical; change them together.
 */

/** The three operational roles. `admin` ⊇ `sales` ⊇ `workshop` in price visibility. */
export type OrgRole = "admin" | "sales" | "workshop";

/**
 * Map a raw `member.role` string (Better Auth's column) onto an {@link OrgRole}.
 * The auto-provisioned org owner carries Better Auth's `owner` role → it maps to
 * `admin` (the tenant administrator). Anything unrecognised — including Better
 * Auth's bare `member` default — returns `null`: the guard treats an unmappable
 * role as no role and fails CLOSED (403), never as a silent least-privilege grant.
 */
export function mapMemberRole(raw: string | null | undefined): OrgRole | null {
  switch (raw) {
    case "owner":
    case "admin":
      return "admin";
    case "sales":
      return "sales";
    case "workshop":
      return "workshop";
    default:
      return null;
  }
}

/** The price-blind role — its responses are stripped of every price/margin field. */
export function isPriceBlind(role: OrgRole): boolean {
  return role === "workshop";
}
