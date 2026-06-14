/**
 * Organization access-control roles (ADR 0057) — the CLIENT copy of the Better
 * Auth org-plugin permission matrix, passed to `organizationClient({ ac, roles })`
 * in `./client` so the role-typed call sites (`inviteMember({ role })`) and any
 * client `checkRolePermission` agree with server enforcement.
 *
 * Deliberately duplicated rather than shared with the server: the SERVER copy
 * lives in `apps/api/src/modules/auth/org-access.ts` (the api consumes built
 * `dist`, this is a source-only React package — importing across would force a
 * build change for ten lines), and server/client are separate runtimes anyway.
 * **Keep the two in lockstep.**
 *
 * These roles ARE the gate for the INVITATION + MEMBER-MANAGEMENT lifecycle,
 * which Better Auth's organization plugin owns end-to-end (its endpoints mount
 * outside Nest at `/api/auth/*`). Distinct from, but aligned with, the app-route
 * RBAC (`OrgRole`/`RolesGuard`) that gates `/v1/*`; the `member.role` string is
 * the join — Better Auth writes it on invite/accept, `mapMemberRole` reads it.
 *
 * The role strings are the union in `@repo/validators` `ORG_ROLES`
 * (admin/sales/workshop) PLUS Better Auth's structural `owner`/`member`:
 *   - `owner`    — the auto-provisioned tenant founder (maps to `admin` on the
 *                  app side); full org/member/invitation control.
 *   - `admin`    — tenant administrator; can invite + manage members.
 *   - `sales`    — issues quotes, sees prices; NO member management.
 *   - `workshop` — price-blind; NO member management.
 *   - `member`   — Better Auth's bare default; carried for structural
 *                  completeness, unused by our invite flow (maps to no app role
 *                  → fails closed at the `/v1/*` guard).
 */
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/** Access controller over the org-plugin's default resource statements. */
export const ac = createAccessControl(defaultStatements);

/**
 * Role → permission map. `owner`/`admin`/`member` reuse Better Auth's exact
 * default statement sets (so we inherit upstream's matrix verbatim); `sales`
 * and `workshop` get the empty set — they can call the org-plugin's read
 * endpoints but can never invite, cancel, or mutate a membership.
 */
const owner = ac.newRole(ownerAc.statements);
const admin = ac.newRole(adminAc.statements);
const member = ac.newRole(memberAc.statements);
const sales = ac.newRole({});
const workshop = ac.newRole({});

/** The role table passed to `organizationClient({ ac, roles })`. */
export const orgAccessRoles = { owner, admin, member, sales, workshop };
