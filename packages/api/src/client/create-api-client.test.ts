import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient, type ApiMiddleware } from "./create-api-client";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function makeClient(middleware?: ApiMiddleware[]) {
  return createApiClient({ baseUrl: "https://api.test", getToken: () => "tok", middleware });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch success", () => {
  it("returns the parsed body and injects auth + content-type on a POST", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }));

    const result = await makeClient().apiFetch<{ id: number }>("/things", {
      method: "POST",
      body: { a: 1 },
    });

    expect(result).toEqual({ id: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/things");
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("resolves undefined on 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(makeClient().apiFetch("/things")).resolves.toBeUndefined();
  });

  it("passes FormData through untouched without forcing a JSON content-type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const form = new FormData();
    form.append("file", "data");

    await makeClient().apiFetch("/upload", { method: "POST", body: form });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe(form); // not JSON-stringified
    expect((init.headers as Headers).get("Content-Type")).toBeNull();
  });

  it("joins base + path without a double slash", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: "https://api.test/" });
    await client.apiFetch("/things");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/things");
  });

  it("uses an injected terminal fetch instead of the global (in-process transport)", async () => {
    const injected = vi.fn().mockResolvedValue(jsonResponse({ via: "injected" }));
    const client = createApiClient({ baseUrl: "https://api.test", fetch: injected });
    const result = await client.apiFetch<{ via: string }>("/things");
    expect(result).toEqual({ via: "injected" });
    expect(injected).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled(); // global fetch untouched
  });
});

describe("bearer cross-origin safety", () => {
  it("withholds Authorization when the path is an absolute URL to a different origin", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await makeClient().apiFetch("https://evil.com/steal");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://evil.com/steal");
    // The bearer must NOT leak to a foreign origin (token exfil).
    expect((init.headers as Headers).get("Authorization")).toBeNull();
  });

  it("still attaches Authorization for a relative path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await makeClient().apiFetch("/users/me");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/users/me");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok");
  });

  it("still attaches Authorization for an absolute URL to the same origin", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await makeClient().apiFetch("https://api.test/users/me");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/users/me");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok");
  });

  // A RELATIVE baseUrl ("/api") + a bearer is the case where a fail-OPEN origin
  // check would still leak (new URL("/api") throws → must fail closed).
  it("withholds Authorization for an absolute foreign URL under a relative baseUrl", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: "/api", getToken: () => "tok" });

    await client.apiFetch("https://evil.com/steal");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://evil.com/steal");
    expect((init.headers as Headers).get("Authorization")).toBeNull();
  });

  it("still attaches Authorization for a relative path under a relative baseUrl", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: "/api", getToken: () => "tok" });

    await client.apiFetch("/users/me");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/users/me");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok");
  });
});

describe("apiFetch http errors", () => {
  it("builds an http ApiError from the error envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Nope", code: "E_NOPE" }, { status: 422 }),
    );

    await expect(makeClient().apiFetch("/things")).rejects.toMatchObject({
      kind: "http",
      status: 422,
      message: "Nope",
      code: "E_NOPE",
    });
  });

  it("surfaces field errors and a parsed Retry-After on the ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { message: "Invalid", code: "E_VALIDATION", errors: { email: ["taken"] } },
        { status: 422, headers: { "Content-Type": "application/json", "Retry-After": "30" } },
      ),
    );

    const error = (await makeClient()
      .apiFetch("/things")
      .catch((e: unknown) => e)) as ApiError;
    expect(error.fieldErrors).toEqual({ email: ["taken"] });
    expect(error.retryAfterMs).toBe(30_000);
  });

  it("falls back to statusText when the body is not an envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ unexpected: true }, { status: 500, statusText: "Server Error" }),
    );

    const error = await makeClient()
      .apiFetch("/things")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("Server Error");
    expect((error as ApiError).code).toBeUndefined();
  });
});

describe("apiFetch network + parse errors", () => {
  it("normalizes a fetch rejection to a network ApiError and logs", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(makeClient().apiFetch("/things")).rejects.toMatchObject({
      kind: "network",
      status: 0,
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("normalizes invalid JSON to a parse ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<<not json>>", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(makeClient().apiFetch("/things")).rejects.toMatchObject({ kind: "parse" });
  });

  it("normalizes a failing options.parse to a parse ApiError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }));
    await expect(
      makeClient().apiFetch("/things", {
        parse: () => {
          throw new Error("bad shape");
        },
      }),
    ).rejects.toMatchObject({ kind: "parse" });
  });
});

describe("apiFetch cancellation", () => {
  it("forwards the AbortSignal through to fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const controller = new AbortController();
    await makeClient().apiFetch("/things", { signal: controller.signal });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.signal).toBe(controller.signal);
  });

  it("normalizes an aborted request to a network ApiError", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
    await expect(makeClient().apiFetch("/things")).rejects.toMatchObject({
      kind: "network",
      status: 0,
    });
  });
});

describe("apiFetch middleware", () => {
  it("runs the chain around the request, outermost first, and can mutate it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }));
    const order: string[] = [];

    const outer: ApiMiddleware = async (req, next) => {
      order.push("outer:before");
      const res = await next(req);
      order.push("outer:after");
      return res;
    };
    const inner: ApiMiddleware = async (req, next) => {
      order.push("inner:before");
      (req.init.headers as Headers).set("X-Trace", "1");
      const res = await next(req);
      order.push("inner:after");
      return res;
    };

    await makeClient([outer, inner]).apiFetch("/things");

    expect(order).toEqual(["outer:before", "inner:before", "inner:after", "outer:after"]);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Headers).get("X-Trace")).toBe("1");
  });

  it("lets a middleware short-circuit without calling fetch", async () => {
    const shortCircuit: ApiMiddleware = async () => jsonResponse({ cached: true });

    const result = await makeClient([shortCircuit]).apiFetch<{ cached: boolean }>("/things");

    expect(result).toEqual({ cached: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("response envelope seam (ADR 0030)", () => {
  // The primat-style envelope: every 2xx wraps the payload, every error nests
  // the fields one level down — the exact shape the seam exists for.
  const envelopeClient = (overrides?: Partial<Parameters<typeof createApiClient>[0]>) =>
    createApiClient({
      baseUrl: "https://api.test",
      envelope: {
        unwrap: (data) => {
          const env = data as { success?: boolean; data?: unknown };
          if (env.success !== true) throw new Error("not an envelope");
          return env.data;
        },
        mapError: (body) => {
          const env = body as { error?: { message?: string; code?: string } };
          if (!env.error) return undefined;
          return { message: env.error.message, code: env.error.code };
        },
      },
      ...overrides,
    });

  it("unwraps the 2xx envelope before the per-call parse", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 7 }, timestamp: "t", version: "v2" }),
    );

    const result = await envelopeClient().apiFetch<{ id: number }>("/things", {
      parse: (data) => data as { id: number },
    });

    expect(result).toEqual({ id: 7 });
  });

  it("normalizes an unwrap throw into a parse ApiError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: "shape" }));

    const error = await envelopeClient()
      .apiFetch("/things")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("parse");
    expect((error as ApiError).body).toEqual({ unexpected: "shape" });
  });

  it("maps a nested error envelope via mapError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, error: { code: "PAYWALL", message: "Upgrade required" } },
        { status: 402 },
      ),
    );

    const error = await envelopeClient()
      .apiFetch("/things")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(402);
    expect((error as ApiError).code).toBe("PAYWALL");
    expect((error as ApiError).message).toBe("Upgrade required");
  });

  it("falls back to the default error envelope when mapError declines", async () => {
    // Flat default-schema shape — mapError returns undefined for it.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Bad input", code: "VALIDATION" }, { status: 400 }),
    );

    const error = await envelopeClient()
      .apiFetch("/things")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("Bad input");
    expect((error as ApiError).code).toBe("VALIDATION");
  });

  it("leaves clients without an envelope config untouched", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 7 } }));
    const result = await makeClient().apiFetch<{ success: boolean }>("/things");
    expect(result).toEqual({ success: true, data: { id: 7 } });
  });
});
