import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../client/create-api-client";
import { createRetryMiddleware } from "./retry";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function makeClient(retries = 2, baseDelayMs = 0, maxDelayMs = 0) {
  return createApiClient({
    baseUrl: "https://api.test",
    middleware: [createRetryMiddleware({ retries, baseDelayMs, maxDelayMs })],
  });
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

describe("createRetryMiddleware", () => {
  it("retries an idempotent GET on 503 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "down" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(makeClient().apiFetch("/things")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on a network rejection then succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(makeClient().apiFetch("/things")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget and throws the last error", async () => {
    // Fresh response per call — a retried response has had its body cancelled.
    fetchMock.mockImplementation(() => jsonResponse({ message: "down" }, { status: 500 }));

    await expect(makeClient(2).apiFetch("/things")).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("never retries a mutation (POST)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "down" }, { status: 503 }));

    await expect(
      makeClient().apiFetch("/things", { method: "POST", body: { a: 1 } }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable 4xx", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, { status: 404 }));

    await expect(makeClient().apiFetch("/things")).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After (delta seconds) before retrying", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "slow down" },
          { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "1" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    vi.useFakeTimers();
    try {
      const promise = makeClient(2, 999_999).apiFetch("/things");
      // Flush the pending 429 read, then advance past the 1s Retry-After wait.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts the backoff wait when the signal fires (normalized to a network error)", async () => {
    fetchMock.mockImplementation(() => jsonResponse({ message: "down" }, { status: 503 }));
    vi.spyOn(Math, "random").mockReturnValue(0.99); // pin jitter to a long backoff
    const controller = new AbortController();

    vi.useFakeTimers();
    try {
      const promise = makeClient(5, 10_000, 10_000)
        .apiFetch("/things", { signal: controller.signal })
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0); // resolve the first 503, enter backoff
      controller.abort();
      const result = await promise;
      // The aborted backoff propagates out and apiFetch normalizes it like any
      // transport failure (consistent with an aborted fetch).
      expect(result).toMatchObject({ kind: "network", status: 0 });
    } finally {
      vi.useRealTimers();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1); // never re-fetched after abort
  });
});
