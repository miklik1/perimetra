import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookDeliveryError,
  WebhookDispatcher,
} from "./webhook-dispatcher.service.js";

const SECRET = "whsec_test_secret";
const TS = 1_718_000_000;
// Known vector: HMAC-SHA256(SECRET, "1718000000.hello") — pinned so a
// refactor that silently changes the signed string (separator, encoding,
// digest) fails loudly instead of breaking every receiver in production.
const HELLO_V1 = "c0ec573d3342fe8e86d0724923ee5b0b5961f8d6fddf45c1c7290dc9ca3c46cf";

const EVENT = {
  id: "0190a8c0-0000-7000-8000-000000000001",
  type: "project.created",
  payload: { projectId: "p-1" },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebhookDispatcher.sign", () => {
  it("produces the Stripe-style t=,v1= header over `${t}.${payload}` (known vector)", () => {
    expect(new WebhookDispatcher().sign("hello", SECRET, TS)).toBe(`t=${TS},v1=${HELLO_V1}`);
  });

  it("different secret or payload changes v1", () => {
    const dispatcher = new WebhookDispatcher();
    expect(dispatcher.sign("hello", "other_secret", TS)).not.toContain(HELLO_V1);
    expect(dispatcher.sign("hello!", SECRET, TS)).not.toContain(HELLO_V1);
  });
});

describe("WebhookDispatcher.verify", () => {
  const dispatcher = new WebhookDispatcher();
  const header = `t=${TS},v1=${HELLO_V1}`;

  it("accepts a valid signature inside the tolerance window", () => {
    expect(dispatcher.verify(header, "hello", SECRET, { now: TS + 60 })).toBe(true);
  });

  it("rejects a tampered payload", () => {
    expect(dispatcher.verify(header, "hellp", SECRET, { now: TS })).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(dispatcher.verify(header, "hello", "other_secret", { now: TS })).toBe(false);
  });

  it("rejects a stale timestamp (replay window, default 300s)", () => {
    expect(dispatcher.verify(header, "hello", SECRET, { now: TS + 301 })).toBe(false);
    expect(dispatcher.verify(header, "hello", SECRET, { now: TS + 299 })).toBe(true);
  });

  it("rejects malformed headers without throwing", () => {
    expect(dispatcher.verify("", "hello", SECRET, { now: TS })).toBe(false);
    expect(dispatcher.verify("t=abc,v1=", "hello", SECRET, { now: TS })).toBe(false);
    expect(dispatcher.verify("v1=deadbeef", "hello", SECRET, { now: TS })).toBe(false);
  });
});

describe("WebhookDispatcher.deliver", () => {
  it("POSTs the signed body with signature + dedup-id headers and reports the status", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const dispatcher = new WebhookDispatcher();
    const delivery = await dispatcher.deliver("https://receiver.test/hook", EVENT, SECRET, {
      timestamp: TS,
    });

    expect(delivery.status).toBe(200);
    expect(delivery.durationMs).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://receiver.test/hook");
    const headers = init!.headers as Record<string, string>;
    const body = init!.body as string;

    // The signature verifies against the EXACT body string that was sent.
    expect(headers[WEBHOOK_ID_HEADER]).toBe(EVENT.id);
    expect(dispatcher.verify(headers[WEBHOOK_SIGNATURE_HEADER]!, body, SECRET, { now: TS })).toBe(
      true,
    );
    expect(JSON.parse(body)).toEqual({ ...EVENT, timestamp: TS });
  });

  it("throws WebhookDeliveryError with the status on non-2xx (the BullMQ retry signal)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      new WebhookDispatcher().deliver("https://receiver.test/hook", EVENT, SECRET),
    ).rejects.toMatchObject({
      name: "WebhookDeliveryError",
      status: 500,
      url: "https://receiver.test/hook",
    });
  });

  it("throws WebhookDeliveryError with status null on timeout/network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    const error = await new WebhookDispatcher()
      .deliver("https://receiver.test/hook", EVENT, SECRET, { timeoutMs: 1 })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WebhookDeliveryError);
    expect((error as WebhookDeliveryError).status).toBeNull();
  });
});
