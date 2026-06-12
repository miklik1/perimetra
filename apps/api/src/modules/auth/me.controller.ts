/** First consumer of the session guard: `GET /v1/me` echoes the session user. */
import { Controller, Get, UseGuards } from "@nestjs/common";

import { CurrentSession } from "./current-session.decorator.js";
import { SessionGuard, type SessionContext } from "./session.guard.js";

@Controller("me")
@UseGuards(SessionGuard)
export class MeController {
  @Get()
  me(@CurrentSession() session: SessionContext): SessionContext["user"] {
    return session.user;
  }
}
