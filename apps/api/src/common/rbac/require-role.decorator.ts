import { SetMetadata, type CustomDecorator } from "@nestjs/common";

import { type OrgRole } from "./org-role.js";

export const REQUIRE_ROLE_METADATA_KEY = "require-role";

/**
 * Restrict a route (or whole controller) to a set of {@link OrgRole}s (ADR 0056).
 * `RolesGuard` reads this metadata and 403s a session whose active-org role is
 * not in the set — fail-closed. A route with NO `@RequireRole` still has its
 * role resolved-and-attached by the guard (for price-blind DTO shaping) but is
 * not role-restricted.
 *
 * ```ts
 * @Post()
 * @RequireRole("admin", "sales")
 * issue(@CurrentRole() role: OrgRole, @Body() body: IssueQuoteDto) { ... }
 * ```
 */
export const RequireRole = (...roles: [OrgRole, ...OrgRole[]]): CustomDecorator<string> =>
  SetMetadata(REQUIRE_ROLE_METADATA_KEY, roles);
