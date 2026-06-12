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
import { userChannel } from "./realtime.tokens.js";

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

    // user:<id> — own channel only. org:<id> — dormant tenancy seam: DENY
    // until ADR 0041 lands membership checks (fail closed, not open).
    if (channel.startsWith("user:") && channel !== userChannel(session.user.id)) {
      throw new ForbiddenException({ message: "Not your channel", code: "forbidden" });
    }
    if (channel.startsWith("org:")) {
      throw new ForbiddenException({
        message: "Organization channels are not enabled",
        code: "forbidden",
      });
    }

    return { token: await this.realtime.subscriptionToken(session.user.id, channel) };
  }
}
