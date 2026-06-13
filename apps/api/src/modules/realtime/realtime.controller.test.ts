import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type SessionContext } from "../auth/session.guard.js";
import { RealtimeController } from "./realtime.controller.js";
import { type RealtimeService } from "./realtime.service.js";

/**
 * Channel authorization (ADR 0055): `user:<id>` is own-channel-only and
 * `org:<id>` is the session's active org only — both fail closed.
 */
function makeController() {
  const subscriptionToken = vi.fn().mockResolvedValue("sub-token");
  const realtime = { subscriptionToken } as unknown as RealtimeService;
  return { controller: new RealtimeController(realtime), subscriptionToken };
}

function session(userId: string, activeOrganizationId: string | null): SessionContext {
  return { user: { id: userId }, session: { activeOrganizationId } } as unknown as SessionContext;
}

describe("RealtimeController.subscribeToken authorization", () => {
  it("issues a token for the session's own org channel", async () => {
    const { controller, subscriptionToken } = makeController();
    const result = await controller.subscribeToken(
      { channel: "org:org-1" },
      session("u-1", "org-1"),
    );
    expect(result.token).toBe("sub-token");
    expect(subscriptionToken).toHaveBeenCalledWith("u-1", "org:org-1");
  });

  it("denies a different organization's channel", async () => {
    const { controller } = makeController();
    await expect(
      controller.subscribeToken({ channel: "org:org-2" }, session("u-1", "org-1")),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies any org channel for an org-less session", async () => {
    const { controller } = makeController();
    await expect(
      controller.subscribeToken({ channel: "org:org-1" }, session("u-1", null)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("still allows a user their own channel and denies another's", async () => {
    const { controller, subscriptionToken } = makeController();
    await expect(
      controller.subscribeToken({ channel: "user:u-1" }, session("u-1", "org-1")),
    ).resolves.toEqual({ token: "sub-token" });
    expect(subscriptionToken).toHaveBeenCalledWith("u-1", "user:u-1");

    await expect(
      controller.subscribeToken({ channel: "user:u-2" }, session("u-1", "org-1")),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a malformed channel with a validation error", async () => {
    const { controller } = makeController();
    await expect(
      controller.subscribeToken({ channel: "bogus" }, session("u-1", "org-1")),
    ).rejects.toThrow();
  });
});
