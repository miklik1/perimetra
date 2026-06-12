import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxyToBackend } from "./backend-proxy";

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
