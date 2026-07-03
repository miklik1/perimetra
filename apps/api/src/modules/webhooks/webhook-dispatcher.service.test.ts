import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookDeliveryError,
  WebhookDispatcher,
} from "./webhook-dispatcher.service.js";

// These suites mock global fetch, so only the SYNCHRONOUS guard layer
// (scheme + IP-literal allowlist + metadata-hostname pre-block) fires here.
// The DNS layer — hostname→private resolution, mixed answers, rebinding —
// lives in the guarded dispatcher's connector and is covered by
// `common/http/ssrf-guard.test.ts` (injected resolver) and
// `webhook-dispatcher.ssrf.test.ts` (real transport against loopback).

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

  it("attaches the SSRF-guarded dispatcher to every guarded request (rebinding layer)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await new WebhookDispatcher().deliver("https://receiver.test/hook", EVENT, SECRET);

    const init = fetchMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(init.dispatcher).toBeDefined();
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

  it("fetches with redirect: manual (the guard, not fetch, follows Location)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await new WebhookDispatcher().deliver("https://receiver.test/hook", EVENT, SECRET);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });

  it("cancels the response body instead of buffering it (hostile-receiver DoS)", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const response = new Response("x".repeat(64), { status: 200 });
    Object.defineProperty(response, "body", { value: { cancel } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await new WebhookDispatcher().deliver("https://receiver.test/hook", EVENT, SECRET);

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("WebhookDispatcher.deliver — SSRF egress guard (sync pre-flight)", () => {
  /** Expect the delivery to be blocked BEFORE any socket opens. */
  async function expectBlocked(url: string, reason: RegExp) {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const error = await new WebhookDispatcher()
      .deliver(url, EVENT, SECRET)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WebhookDeliveryError);
    expect((error as WebhookDeliveryError).status).toBeNull();
    expect((error as WebhookDeliveryError).message).toMatch(/blocked/);
    expect((error as WebhookDeliveryError).message).toMatch(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  }

  it("rejects non-http(s) schemes", async () => {
    await expectBlocked("ftp://receiver.test/hook", /scheme "ftp:"/);
    await expectBlocked("file:///etc/passwd", /scheme "file:"/);
  });

  it("rejects IPv4 loopback", async () => {
    await expectBlocked("http://127.0.0.1/hook", /loopback/);
    await expectBlocked("http://127.8.9.10:8080/hook", /loopback/);
  });

  it("rejects RFC1918 private ranges (all three)", async () => {
    await expectBlocked("http://10.0.0.8/hook", /private/);
    await expectBlocked("http://172.16.0.1/hook", /private/);
    await expectBlocked("http://172.31.255.255/hook", /private/);
    await expectBlocked("http://192.168.1.5/hook", /private/);
  });

  it("rejects link-local incl. the cloud-metadata IP, plus CGNAT", async () => {
    await expectBlocked("http://169.254.1.1/hook", /linkLocal/);
    await expectBlocked("http://169.254.169.254/latest/meta-data/", /linkLocal/);
    await expectBlocked("http://100.64.0.1/hook", /carrierGradeNat/);
  });

  it("rejects the unspecified address and obfuscated numeric hosts", async () => {
    await expectBlocked("http://0.0.0.0/hook", /unspecified/);
    // WHATWG URL canonicalizes decimal/hex hosts — both ARE 127.0.0.1.
    await expectBlocked("http://2130706433/hook", /loopback/);
    await expectBlocked("http://0x7f.0.0.1/hook", /loopback/);
  });

  it("rejects cloud-metadata hostnames without resolving them", async () => {
    await expectBlocked("http://metadata.google.internal/computeMetadata/v1/", /metadata/);
    await expectBlocked("http://metadata.goog/computeMetadata/v1/", /metadata/);
  });

  it("rejects IPv6 loopback, unique-local (incl. IMDSv6), link-local, and unspecified", async () => {
    await expectBlocked("http://[::1]/hook", /loopback/);
    await expectBlocked("http://[fd00::1]/hook", /uniqueLocal/);
    await expectBlocked("http://[fc00::1]/hook", /uniqueLocal/);
    await expectBlocked("http://[fd00:ec2::254]/hook", /uniqueLocal/); // AWS IMDSv6
    await expectBlocked("http://[fe80::1]/hook", /linkLocal/);
    await expectBlocked("http://[::]/hook", /unspecified/);
  });

  it("unwraps IPv4-mapped IPv6 before classifying", async () => {
    await expectBlocked("http://[::ffff:10.0.0.1]/hook", /private/);
    await expectBlocked("http://[::ffff:127.0.0.1]/hook", /loopback/);
  });

  it("unwraps IPv4-COMPATIBLE IPv6 (::/96) — the blocklist regression that failed open", async () => {
    // [::127.0.0.1] serialises to [::7f00:1], which a ::ffff:-only blocklist
    // classifies as a plain (allowed) global v6 — the allowlist recursion
    // judges the embedded v4 instead.
    await expectBlocked("http://[::127.0.0.1]/hook", /loopback/);
    await expectBlocked("http://[::7f00:1]/hook", /loopback/);
    await expectBlocked("http://[::169.254.169.254]/hook", /linkLocal/);
  });

  it("allowPrivateNetwork: true permits a private target (trusted first-party opt-out)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const delivery = await new WebhookDispatcher().deliver(
      "http://127.0.0.1:4001/internal-hook",
      EVENT,
      SECRET,
      { allowPrivateNetwork: true },
    );

    expect(delivery.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4001/internal-hook",
      expect.objectContaining({ method: "POST" }),
    );
    // The opt-out uses plain fetch — the guarded dispatcher would refuse to
    // dial the private address the caller explicitly trusted.
    const init = fetchMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(init.dispatcher).toBeUndefined();
  });

  it("allowPrivateNetwork: true still rejects non-http(s) schemes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      new WebhookDispatcher().deliver("gopher://127.0.0.1/hook", EVENT, SECRET, {
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow(/scheme "gopher:"/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("public URLs still deliver (the guard is invisible to legitimate targets)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    const delivery = await new WebhookDispatcher().deliver(
      "https://receiver.test/hook",
      EVENT,
      SECRET,
    );

    expect(delivery.status).toBe(200);
  });
});

describe("WebhookDispatcher.deliver — manual redirect handling", () => {
  function redirectTo(location: string, status = 302) {
    return new Response(null, { status, headers: { location } });
  }

  it("follows a redirect to a public target, re-POSTing the same signed body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(redirectTo("https://other.test/hook"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const delivery = await new WebhookDispatcher().deliver(
      "https://receiver.test/hook",
      EVENT,
      SECRET,
      { timestamp: TS },
    );

    expect(delivery.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0]!;
    const [secondUrl, secondInit] = fetchMock.mock.calls[1]!;
    expect(firstUrl).toBe("https://receiver.test/hook");
    expect(secondUrl).toBe("https://other.test/hook");
    expect(secondInit!.method).toBe("POST");
    expect(secondInit!.body).toBe(firstInit!.body);
    // Both hops ride the SAME guarded dispatcher (one per delivery).
    const firstAgent = (firstInit as Record<string, unknown>).dispatcher;
    const secondAgent = (secondInit as Record<string, unknown>).dispatcher;
    expect(firstAgent).toBeDefined();
    expect(secondAgent).toBe(firstAgent);
  });

  it("resolves a relative Location against the current target", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(redirectTo("/moved", 308))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await new WebhookDispatcher().deliver("https://receiver.test/hook", EVENT, SECRET);

    expect(fetchMock.mock.calls[1]![0]).toBe("https://receiver.test/moved");
  });

  it("re-runs the FULL guard on the redirect target: private Location is blocked", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(redirectTo("http://169.254.169.254/latest/meta-data/"));

    const error = await new WebhookDispatcher()
      .deliver("https://receiver.test/hook", EVENT, SECRET)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WebhookDeliveryError);
    expect((error as WebhookDeliveryError).message).toMatch(/blocked.*linkLocal/);
    // The poisoned hop was never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails after the redirect cap (3) instead of looping", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(redirectTo("https://receiver.test/hook"));

    await expect(
      new WebhookDispatcher().deliver("https://receiver.test/hook", EVENT, SECRET),
    ).rejects.toThrow(/more than 3 redirects/);
    // Initial request + 3 followed hops, then stop.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails on a redirect without a Location header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 301 }));

    await expect(
      new WebhookDispatcher().deliver("https://receiver.test/hook", EVENT, SECRET),
    ).rejects.toThrow(/without a Location header/);
  });
});
