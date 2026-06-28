import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxyToBackend } from "./backend-proxy";

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@repo/utils", () => ({ logger }));

// Captures the headers `proxyToBackend` sends upstream by stubbing global fetch
// (the proxy's terminal hop). Asserts the request-header allowlist: only safe
// headers are relayed, and credential headers (Authorization + Cookie) are
// gated behind `forwardCredentials` so they never egress to an untrusted /
// unconfigured backend origin (security gap, ADR 0018).
const backendBaseUrl = "https://api.example.com";

function makeRequest(): Request {
  return new Request("https://app.local/api/users", {
    method: "GET",
    headers: {
      accept: "application/json",
      "accept-language": "en",
      "content-type": "application/json",
      "user-agent": "vitest",
      authorization: "Bearer secret-token",
      cookie: "refresh=secret-cookie",
      "x-evil": "should-not-pass",
    },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentHeaders(): Headers {
  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
  return init.headers as Headers;
}

describe("proxyToBackend request-header allowlist", () => {
  it("forwards only allowlisted safe headers and drops unknown ones", async () => {
    await proxyToBackend(makeRequest(), { backendBaseUrl });

    const headers = sentHeaders();
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("accept-language")).toBe("en");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("vitest");
    expect(headers.get("x-evil")).toBeNull();
  });

  it("strips credential headers by default (no forwardCredentials)", async () => {
    await proxyToBackend(makeRequest(), { backendBaseUrl });

    const headers = sentHeaders();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
  });

  it("relays credential headers only when forwardCredentials is true", async () => {
    await proxyToBackend(makeRequest(), { backendBaseUrl, forwardCredentials: true });

    const headers = sentHeaders();
    expect(headers.get("authorization")).toBe("Bearer secret-token");
    expect(headers.get("cookie")).toBe("refresh=secret-cookie");
  });
});

describe("proxyToBackend upstream failure", () => {
  it("logs the swallowed upstream error before returning 502", async () => {
    const boom = new Error("ECONNREFUSED");
    fetchSpy = vi.fn(async () => {
      throw boom;
    });
    vi.stubGlobal("fetch", fetchSpy);

    const response = await proxyToBackend(makeRequest(), { backendBaseUrl });

    expect(response.status).toBe(502);
    expect(logger.error).toHaveBeenCalledWith("Backend proxy failed", { error: boom });
  });
});

describe("proxyToBackend Location rewrite (origin hiding)", () => {
  // Security regression: with redirect:"manual" an upstream 3xx is returned
  // verbatim. An absolute Location pointing at the (hidden) backend origin would
  // leak the internal host:port to the browser — defeating the proxy's purpose.
  it("rewrites a backend-origin Location to the same-origin /api mount", async () => {
    fetchSpy = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `${backendBaseUrl}/v1/projects/42` },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await proxyToBackend(makeRequest(), { backendBaseUrl });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/api/v1/projects/42");
  });

  it("passes a cross-origin Location (e.g. an OAuth provider) through unchanged", async () => {
    const external = "https://accounts.example-idp.com/o/oauth2/auth?client_id=x";
    fetchSpy = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: external } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await proxyToBackend(makeRequest(), { backendBaseUrl });
    expect(res.headers.get("location")).toBe(external);
  });
});
