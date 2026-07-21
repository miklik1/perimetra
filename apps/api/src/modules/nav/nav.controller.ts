/**
 * `GET /v1/me/nav-counts` (1c-3) — the badge counts the authenticated app shell
 * paints on its nav entries (design §4.1). A companion to `MeController`'s
 * `/v1/me` (the auth module owns the identity read; auth is a leaf and may not
 * import the priced modules, so the aggregator lives here, importing quotes +
 * orders). Both mount under the `me` prefix — distinct route paths, so the two
 * controllers coexist.
 *
 * Session auth comes from the global default-deny SessionGuard (ADR 0099); the
 * class-level RolesGuard resolves the caller's active-org `role` (and 403s an
 * org-less session, via `@CurrentScope`) so the counts are role-filtered.
 */
import { Controller, Get, UseGuards } from "@nestjs/common";

import { CurrentRole } from "../../common/rbac/current-role.decorator.js";
import { type OrgRole } from "../../common/rbac/org-role.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { NavCountsService, type NavCounts } from "./nav-counts.service.js";

@Controller("me")
@UseGuards(RolesGuard)
export class NavController {
  constructor(private readonly counts: NavCountsService) {}

  @Get("nav-counts")
  async getNavCounts(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
  ): Promise<NavCounts> {
    return this.counts.forCaller(scope, role);
  }
}
