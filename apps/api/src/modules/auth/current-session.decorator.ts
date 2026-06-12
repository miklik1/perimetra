import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import { type SessionContext, type SessionRequest } from "./session.guard.js";

/**
 * Injects the `{ session, user }` the SessionGuard attached. Throwing (not
 * returning undefined) when the guard is missing makes the misconfiguration
 * loud in the first request, not in a downstream `cannot read user of…`.
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionContext => {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    if (!request.sessionContext) {
      throw new Error("@CurrentSession() used on a route without SessionGuard");
    }
    return request.sessionContext;
  },
);
