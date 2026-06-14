/**
 * RBAC guard (ADR 0056) — runs AFTER `SessionGuard` (which attaches the
 * session). Two jobs, both fail-closed:
 *
 *  1. Resolve the caller's active-org {@link OrgRole} from the authoritative
 *     `member` table and attach it to the request, so `@CurrentRole()` consumers
 *     (price-blind DTO shaping) and `@RequireRole` enforcement share one lookup.
 *  2. If the route (or controller) carries `@RequireRole(...)`, 403 a role not
 *     in the set.
 *
 * A session with no resolvable org role is rejected (403) even on routes with NO
 * `@RequireRole` — an authenticated user who is not a member of their active org
 * has no business reaching tenant data. Org-less sessions 403 the same way
 * (`@CurrentScope`/`scopeFromSession` semantics), so the seam stays closed end to end.
 */
import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { type RoleRequest } from "../../common/rbac/current-role.decorator.js";
import { type OrgRole } from "../../common/rbac/org-role.js";
import { REQUIRE_ROLE_METADATA_KEY } from "../../common/rbac/require-role.decorator.js";
import {
  MissingOrganizationScopeError,
  scopeFromSession,
  type RequestScope,
} from "../../common/tenancy/request-scope.js";
import { MembershipService } from "./membership.service.js";
import { type SessionRequest } from "./session.guard.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly membership: MembershipService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest & RoleRequest>();
    if (!request.sessionContext) {
      throw new Error("RolesGuard requires SessionGuard to run first");
    }

    let scope: RequestScope;
    try {
      scope = scopeFromSession(request.sessionContext);
    } catch (error) {
      if (error instanceof MissingOrganizationScopeError) {
        throw new ForbiddenException({ message: "No active organization", code: "forbidden" });
      }
      throw error;
    }

    const role = await this.membership.resolveRole(scope);
    if (!role) {
      throw new ForbiddenException({ message: "No organization role", code: "forbidden" });
    }
    request.orgRole = role;

    const allowed = this.reflector.getAllAndOverride<OrgRole[] | undefined>(
      REQUIRE_ROLE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed && !allowed.includes(role)) {
      throw new ForbiddenException({ message: "Insufficient role", code: "forbidden" });
    }
    return true;
  }
}
