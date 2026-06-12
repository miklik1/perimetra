import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

import { WebhookDispatcher } from "./webhook-dispatcher.service.js";
import { createWebhookRelayHandler, type WebhookEndpointTarget } from "./webhook-relay.handler.js";
import { WebhooksModule } from "./webhooks.module.js";

const EVENT = {
  eventId: "0190a8c0-0000-7000-8000-000000000001",
  eventType: "project.created",
  aggregateType: "project",
  aggregateId: "p-1",
  payload: { projectId: "p-1" },
};

function makeDispatcher(deliver = vi.fn().mockResolvedValue({ status: 200, durationMs: 1 })) {
  return { dispatcher: { deliver } as unknown as WebhookDispatcher, deliver };
}

describe("createWebhookRelayHandler", () => {
  it("is DomainEventHandler-shaped: exposes the configured eventTypes", () => {
    const { dispatcher } = makeDispatcher();
    const handler = createWebhookRelayHandler(dispatcher, {
      eventTypes: ["project.created"],
      endpointsFor: () => [],
    });
    expect(handler.eventTypes).toEqual(["project.created"]);
    expect(typeof handler.handle).toBe("function");
  });

  it("is a no-op when no endpoints subscribe", async () => {
    const { dispatcher, deliver } = makeDispatcher();
    const handler = createWebhookRelayHandler(dispatcher, {
      eventTypes: ["project.created"],
      endpointsFor: () => [],
    });
    await handler.handle(EVENT);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("delivers to every resolved endpoint with the outbox event id and per-endpoint secret", async () => {
    const { dispatcher, deliver } = makeDispatcher();
    const endpoints: WebhookEndpointTarget[] = [
      { url: "https://a.test/hook", secret: "secret-a" },
      { url: "https://b.test/hook", secret: "secret-b" },
    ];
    const handler = createWebhookRelayHandler(dispatcher, {
      eventTypes: ["project.created"],
      endpointsFor: () => endpoints,
    });

    await handler.handle(EVENT);

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledWith(
      "https://a.test/hook",
      { id: EVENT.eventId, type: "project.created", payload: { projectId: "p-1" } },
      "secret-a",
    );
    expect(deliver).toHaveBeenCalledWith(
      "https://b.test/hook",
      expect.objectContaining({ id: EVENT.eventId }),
      "secret-b",
    );
  });

  it("attempts ALL endpoints, then throws if any failed (at-least-once via BullMQ retry)", async () => {
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error("a is down"))
      .mockResolvedValueOnce({ status: 200, durationMs: 1 });
    const { dispatcher } = makeDispatcher(deliver);
    const handler = createWebhookRelayHandler(dispatcher, {
      eventTypes: ["project.created"],
      endpointsFor: () => [
        { url: "https://a.test/hook", secret: "secret-a" },
        { url: "https://b.test/hook", secret: "secret-b" },
      ],
    });

    await expect(handler.handle(EVENT)).rejects.toThrow(/1\/2 webhook deliveries failed/);
    // The healthy endpoint was NOT starved by the dead one.
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});

describe("WebhooksModule", () => {
  it("provides and exports the dispatcher", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WebhooksModule] }).compile();
    expect(moduleRef.get(WebhookDispatcher)).toBeInstanceOf(WebhookDispatcher);
    await moduleRef.close();
  });
});
