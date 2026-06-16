/**
 * Platform/vendor-operator guard (CORE_SPEC §3, ADR 0062) — runs AFTER
 * `SessionGuard` (which attaches the session). Gates the cross-tenant vendor
 * surface: publishing immutable releases/catalog (authoring is vendor-only, §3)
 * and assigning releases to tenant orgs.
 *
 * The operator is Better Auth's `user.role==='admin'` (the admin() plugin's
 * global role — distinct from the per-org `member.role` the `RolesGuard`
 * enforces). It is resolved FRESH from the DB per request via
 * `MembershipService.isPlatformOperator` (NOT the cached `session.user.role`,
 * which the 5-minute cookie cache would make stale) — so a grant/revoke takes
 * effect on the operator's NEXT request, the same freshness contract as
 * `RolesGuard`. Fail-closed: any non-operator session is 403'd.
 */
import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";

import { MembershipService } from "./membership.service.js";
import { type SessionRequest } from "./session.guard.js";

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly membership: MembershipService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    if (!request.sessionContext) {
      throw new Error("PlatformGuard requires SessionGuard to run first");
    }

    const isOperator = await this.membership.isPlatformOperator(request.sessionContext.user.id);
    if (!isOperator) {
      throw new ForbiddenException({
        message: "Platform operator role required",
        code: "forbidden",
      });
    }
    return true;
  }
}
