/**
 * Session guard (ADR 0033): validates the Better Auth cookie via
 * `auth.api.getSession` (cookie-cache hit or Redis/DB lookup) and attaches
 * `{ session, user }` to the request for `@CurrentSession()` consumers.
 *
 * Registered as a global `APP_GUARD` (app.module.ts, ADR 0099): every Nest
 * route is authenticated by default; `@Public()` is the explicit opt-out.
 */
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import { type FastifyRequest } from "fastify";

import { type Auth } from "./auth.instance.js";
import { AUTH } from "./auth.tokens.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

/** Non-null result of `auth.api.getSession` — plugin fields (role, activeOrganizationId…) included. */
export type SessionContext = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export interface SessionRequest extends FastifyRequest {
  sessionContext?: SessionContext;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Handler metadata wins over class metadata (getAllAndOverride).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<SessionRequest>();

    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException("Authentication required");
    }

    request.sessionContext = session;
    return true;
  }
}
