/**
 * Self-service GDPR endpoints (spec §7.7): the CURRENT user requests their
 * own export / erasure — the session is the authorization (no admin scope
 * needed for self-service; admin-initiated flows can call PrivacyService
 * directly later). 202: the work happens async on the privacy queue.
 */
import { Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { SessionGuard, type SessionContext } from "../auth/session.guard.js";
import { PrivacyService } from "./privacy.service.js";

@Controller("privacy")
@UseGuards(SessionGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** Art. 20 — export everything we store about the requesting user. */
  @Post("export")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestExport(@CurrentSession() session: SessionContext): Promise<{ status: string }> {
    await this.privacy.requestExport(session.user.id);
    return { status: "queued" };
  }

  /** Art. 17 — erase the requesting user across all registered handlers. */
  @Post("erase")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestErasure(@CurrentSession() session: SessionContext): Promise<{ status: string }> {
    await this.privacy.requestErasure(session.user.id);
    return { status: "queued" };
  }
}
