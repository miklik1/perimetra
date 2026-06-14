/**
 * Organization access-control roles (ADR 0057) — the SERVER copy of the Better
 * Auth org-plugin permission matrix, passed to `organization({ ac, roles })` in
 * `auth.instance.ts`. It is the authorization for the INVITATION + MEMBER-
 * management lifecycle, which Better Auth owns end-to-end (its endpoints mount
 * outside Nest at `/api/auth/*`, so our `RolesGuard` never sees them — these
 * roles ARE the gate for "who can invite/manage members").
 *
 * Deliberately duplicated, NOT shared via a cross-package import — the same call
 * the codebase already makes for the role TUPLE (`common/rbac/org-role.ts` ↔
 * `@repo/validators` `ORG_ROLES`): the api consumes workspace packages as built
 * `dist`, but `@repo/auth` is a source-only React package, so importing it here
 * would force a build-coupling change for ten lines of config. Server and client
 * are separate runtimes anyway — these `ac`/role objects were always going to be
 * distinct instances. The CLIENT copy lives in `packages/auth/src/permissions.ts`
 * (consumed by `organizationClient`); **keep the two in lockstep.**
 *
 * Roles: `owner`/`admin` can invite + manage members (Better Auth's default
 * statement sets); `sales`/`workshop` get the empty set (read-only — never
 * invite/cancel/mutate a membership); `member` is Better Auth's structural
 * default, carried for completeness (maps to no app role → fails closed at the
 * `/v1/*` guard via `mapMemberRole`).
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

const owner = ac.newRole(ownerAc.statements);
const admin = ac.newRole(adminAc.statements);
const member = ac.newRole(memberAc.statements);
const sales = ac.newRole({});
const workshop = ac.newRole({});

/** The role table passed to `organization({ ac, roles })`. */
export const orgAccessRoles = { owner, admin, member, sales, workshop };
