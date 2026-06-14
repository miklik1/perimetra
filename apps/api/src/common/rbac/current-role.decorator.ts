import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import { type OrgRole } from "./org-role.js";

/** The shape `RolesGuard` attaches to the request once it resolves the role. */
export interface RoleRequest {
  orgRole?: OrgRole;
}

/**
 * Resolves the caller's active-org {@link OrgRole} that `RolesGuard` attached
 * (ADR 0056). Throwing when it is absent (rather than returning a default) keeps
 * a route that forgot `RolesGuard` from silently treating everyone as the same
 * role — a missing guard is a wiring bug, surfaced loudly, never a quiet grant.
 */
export const CurrentRole = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrgRole => {
    const request = context.switchToHttp().getRequest<RoleRequest>();
    if (!request.orgRole) {
      throw new Error("@CurrentRole() used on a route without RolesGuard");
    }
    return request.orgRole;
  },
);
