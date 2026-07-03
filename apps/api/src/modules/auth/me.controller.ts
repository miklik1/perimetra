/**
 * `GET /v1/me` — echoes the session user PLUS the role they hold in their active
 * organization (ADR 0056) AND whether they are the platform/vendor operator
 * (ADR 0062). Both are the SAME authoritative values the BE guards enforce on
 * (the org `role` resolved by `RolesGuard` from `member`; `isPlatformAdmin`
 * resolved fresh from `user.role` by `PlatformGuard`), so the FE mirror reading
 * `/me` can never drift from server enforcement.
 *
 * Session auth comes from the global default-deny SessionGuard (ADR 0099);
 * only the org-role resolution needs the class-level RolesGuard.
 */
import { Controller, Get, UseGuards } from "@nestjs/common";

import { CurrentRole } from "../../common/rbac/current-role.decorator.js";
import { type OrgRole } from "../../common/rbac/org-role.js";
import { CurrentSession } from "./current-session.decorator.js";
import { MembershipService } from "./membership.service.js";
import { RolesGuard } from "./roles.guard.js";
import { type SessionContext } from "./session.guard.js";

@Controller("me")
@UseGuards(RolesGuard)
export class MeController {
  constructor(private readonly membership: MembershipService) {}

  @Get()
  async me(
    @CurrentSession() session: SessionContext,
    @CurrentRole() role: OrgRole,
  ): Promise<
    Pick<SessionContext["user"], "id" | "email" | "name" | "createdAt"> & {
      role: OrgRole;
      isPlatformAdmin: boolean;
    }
  > {
    // Fresh per request (the cached `session.user.role` would be ≤60s stale).
    const isPlatformAdmin = await this.membership.isPlatformOperator(session.user.id);
    // Explicit client-safe allow-list (mirrors `meResponseSchema`): the admin()
    // + twoFactor plugins add banned/banReason/banExpires/twoFactorEnabled to
    // session.user, so spreading it would ship those over the wire. Field-pick
    // only the contract fields; the org `role` + `isPlatformAdmin` are added fresh.
    const { id, email, name, createdAt } = session.user;
    return { id, email, name, createdAt, role, isPlatformAdmin };
  }
}
