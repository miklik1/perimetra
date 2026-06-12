import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../client/create-api-client";
import { clearApiLog, getApiLog } from "./api-log-store";
import { createDebugMiddleware } from "./debug";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  clearApiLog();
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createDebugMiddleware", () => {
  it("logs method/url/status and records to the ring buffer", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "https://api.test",
      middleware: [createDebugMiddleware({ record: true })],
    });

    await client.apiFetch("/things");

    expect(console.debug).toHaveBeenCalledWith(
      expect.stringContaining("GET https://api.test/things → 200"),
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );
    const log = getApiLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ method: "GET", status: 200, url: "https://api.test/things" });
  });

  it("does not record when record is off", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "https://api.test",
      middleware: [createDebugMiddleware()],
    });
    await client.apiFetch("/things");
    expect(getApiLog()).toHaveLength(0);
  });
});
