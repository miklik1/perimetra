/**
 * Centrifugo binding (spec §7.3, closes the frontend's ADR 0029 seam):
 * - connection/subscription JWTs (HS256 via jose; `sub` must be a string,
 *   secret = centrifugo's `client.token.hmac_secret_key`),
 * - publish via the v6 server HTTP API (`POST /api/publish`, `X-API-Key`;
 *   errors arrive as HTTP-200 bodies with an `error` field — checked here).
 *
 * `publish()` FAILS SOFT: realtime is a notification channel, not a source
 * of truth — a Centrifugo outage must never fail the business operation.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { SignJWT } from "jose";

import { ENV, type Env } from "../../common/config/env.js";

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly secret: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.secret = new TextEncoder().encode(env.CENTRIFUGO_TOKEN_SECRET);
  }

  async connectionToken(userId: string): Promise<string> {
    return await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(this.secret);
  }

  async subscriptionToken(userId: string, channel: string): Promise<string> {
    return await new SignJWT({ channel })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime("30m")
      .sign(this.secret);
  }

  /** Fail-soft publish — logs and returns false on any failure. */
  async publish(channel: string, data: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch(`${this.env.CENTRIFUGO_URL}/api/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.env.CENTRIFUGO_API_KEY,
        },
        body: JSON.stringify({ channel, data }),
      });
      const body = (await response.json()) as {
        error?: { code: number; message: string };
      };
      if (!response.ok || body.error) {
        this.logger.error(
          `centrifugo publish to ${channel} failed: ${body.error?.code ?? response.status} ${body.error?.message ?? ""}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(
        `centrifugo unreachable (publish to ${channel})`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }
}
