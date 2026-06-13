import { createParamDecorator, ForbiddenException, type ExecutionContext } from "@nestjs/common";

import {
  MissingOrganizationScopeError,
  scopeFromSession,
  type RequestScope,
  type SessionLike,
} from "./request-scope.js";

/**
 * Resolves the `RequestScope` (ADR 0041/0055) from the session the SessionGuard
 * attached. Throwing (not returning a half-empty scope) when the guard is
 * missing keeps an unguarded route from ever producing an unscoped query.
 *
 * A session without an active organization is rejected with 403 — the seam is
 * fail-closed (no request may produce an org-less query). In practice every
 * user is auto-provisioned an org and every session is stamped (ADR 0055), so
 * this only fires on a genuinely org-less session.
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestScope => {
    const request = context.switchToHttp().getRequest<{ sessionContext?: SessionLike }>();
    if (!request.sessionContext) {
      throw new Error("@CurrentScope() used on a route without SessionGuard");
    }
    try {
      return scopeFromSession(request.sessionContext);
    } catch (error) {
      if (error instanceof MissingOrganizationScopeError) {
        throw new ForbiddenException({ message: "No active organization", code: "forbidden" });
      }
      throw error;
    }
  },
);
