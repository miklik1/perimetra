import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { SessionGuard, type SessionContext } from "../auth/session.guard.js";
import { RealtimeService } from "./realtime.service.js";
import { orgChannel, userChannel } from "./realtime.tokens.js";

const subscribeSchema = z.object({
  channel: z.string().regex(/^(user|org):[\w-]+$/, "unknown channel scheme"),
});

@Controller("realtime")
@UseGuards(SessionGuard)
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get("token")
  async token(@CurrentSession() session: SessionContext): Promise<{ token: string }> {
    return { token: await this.realtime.connectionToken(session.user.id) };
  }

  @Post("subscribe-token")
  async subscribeToken(
    @Body() body: unknown,
    @CurrentSession() session: SessionContext,
  ): Promise<{ token: string }> {
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: "Invalid channel", code: "validation" });
    }
    const { channel } = parsed.data;

    // user:<id> — own channel only. org:<id> — the session's active org only
    // (ADR 0055: membership = the stamped active org; still fail-closed for any
    // other org or an org-less session).
    if (channel.startsWith("user:") && channel !== userChannel(session.user.id)) {
      throw new ForbiddenException({ message: "Not your channel", code: "forbidden" });
    }
    if (channel.startsWith("org:")) {
      const activeOrg = session.session.activeOrganizationId;
      if (!activeOrg || channel !== orgChannel(activeOrg)) {
        throw new ForbiddenException({ message: "Not your organization", code: "forbidden" });
      }
    }

    return { token: await this.realtime.subscriptionToken(session.user.id, channel) };
  }
}
