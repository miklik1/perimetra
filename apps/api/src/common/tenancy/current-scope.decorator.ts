import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import { scopeFromSession, type RequestScope, type SessionLike } from "./request-scope.js";

/**
 * Resolves the `RequestScope` (ADR 0041) from the session the SessionGuard
 * attached. Throwing (not returning a half-empty scope) when the guard is
 * missing keeps an unguarded route from ever producing an unscoped query.
 */
export const CurrentScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestScope => {
    const request = context.switchToHttp().getRequest<{ sessionContext?: SessionLike }>();
    if (!request.sessionContext) {
      throw new Error("@CurrentScope() used on a route without SessionGuard");
    }
    return scopeFromSession(request.sessionContext);
  },
);
