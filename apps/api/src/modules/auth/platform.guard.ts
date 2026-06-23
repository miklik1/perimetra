/**
 * Platform/vendor-operator guard (CORE_SPEC §3, ADR 0062) — runs AFTER
 * `SessionGuard` (which attaches the session). Gates the cross-tenant vendor
 * surface: publishing immutable releases/catalog (authoring is vendor-only, §3)
 * and assigning releases to tenant orgs.
 *
 * The operator is Better Auth's `user.role==='admin'` (the admin() plugin's
 * global role — distinct from the per-org `member.role` the `RolesGuard`
 * enforces). It is resolved FRESH from the DB per request via
 * `MembershipService.loadPlatformAccess` (NOT the cached `session.user.role`,
 * which the 5-minute cookie cache would make stale) — so a grant/revoke takes
 * effect on the operator's NEXT request, the same freshness contract as
 * `RolesGuard`. Fail-closed: any non-operator session is 403'd.
 *
 * MFA is MANDATORY here (ADR 0040 / §1 gap): an operator without TOTP enrolled
 * (`user.twoFactorEnabled === false`) is 403'd with a DISTINCT `mfa_required`
 * code so the web can route them to enrollment rather than show a dead end. The
 * publish-immutable-releases / cross-tenant-assign surface is the most dangerous
 * credential — it must not be password-only.
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

    const access = await this.membership.loadPlatformAccess(request.sessionContext.user.id);
    if (!access.isOperator) {
      throw new ForbiddenException({
        message: "Platform operator role required",
        code: "forbidden",
      });
    }
    if (!access.twoFactorEnabled) {
      throw new ForbiddenException({
        message: "Two-factor authentication must be enabled for platform operations",
        code: "mfa_required",
      });
    }
    return true;
  }
}
