import { z } from "zod";

import { userSchema } from "./user";

/**
 * The membership-scoped RBAC roles (ADR 0056). A role is a property of a
 * `member` row (a user WITHIN one organization), never a global `users.role`
 * column — the same user can be `admin` of one org and `sales` of another. The
 * wire/UI contract is single-sourced here so the BE guard (`@repo/validators/
 * roles`) and the FE mirror (`@repo/validators` index → `@repo/api` me query)
 * agree on the exact strings; the BE maps Better Auth's `owner` membership onto
 * `admin` at the boundary (the auto-provisioned org owner is the tenant admin).
 *
 *  - `admin`    — full surface: publish releases/catalog, override the margin
 *                 floor, see prices. The auto-provisioned org owner.
 *  - `sales`    — issues quotes, sees prices; no publish, no margin override.
 *  - `workshop` — geometry/specs only: PRICE-BLIND (server strips price/margin
 *                 fields), cannot issue quotes or publish.
 */
export const ORG_ROLES = ["admin", "sales", "workshop"] as const;
export const orgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof orgRoleSchema>;

/**
 * `GET /v1/me` — the session user plus the role they hold in their ACTIVE org.
 * The FE reads its role from here (the same authoritative source the BE guards
 * resolve from), so FE gating can never drift from server enforcement.
 */
export const meResponseSchema = userSchema.extend({
  role: orgRoleSchema,
  /**
   * Platform/vendor operator flag (ADR 0062) — Better Auth's `user.role==='admin'`,
   * resolved FRESH from the DB per request (not the cached session role), so a
   * grant/revoke takes effect on the caller's NEXT request. Gates the vendor
   * console (publish releases/catalog + per-tenant release assignment).
   * ORTHOGONAL to the org `role` above: a tenant admin is not a platform admin,
   * and the platform operator is (also) an org admin of their own workspace.
   */
  isPlatformAdmin: z.boolean(),
  /**
   * The session's stamped active organization (ADR 0055) — the tenant every
   * scoped read resolves under. `null` while the session is still resolving or
   * the user has no org yet. Surfaced here (the canonical identity endpoint) so
   * the FE can address the tenant realtime channel `org:<id>` without a second
   * Better Auth session read — the same single-source discipline as `role`.
   */
  activeOrganizationId: z.string().nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
