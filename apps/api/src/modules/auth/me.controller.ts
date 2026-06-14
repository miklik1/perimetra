/**
 * `GET /v1/me` — echoes the session user PLUS the role they hold in their active
 * organization (ADR 0056). The role is the SAME authoritative value the BE
 * guards enforce on (resolved by `RolesGuard` from the `member` table), so the
 * FE mirror reading `/me` can never drift from server enforcement.
 */
import { Controller, Get, UseGuards } from "@nestjs/common";

import { CurrentRole } from "../../common/rbac/current-role.decorator.js";
import { type OrgRole } from "../../common/rbac/org-role.js";
import { CurrentSession } from "./current-session.decorator.js";
import { RolesGuard } from "./roles.guard.js";
import { SessionGuard, type SessionContext } from "./session.guard.js";

@Controller("me")
@UseGuards(SessionGuard, RolesGuard)
export class MeController {
  @Get()
  me(
    @CurrentSession() session: SessionContext,
    @CurrentRole() role: OrgRole,
  ): SessionContext["user"] & { role: OrgRole } {
    return { ...session.user, role };
  }
}
