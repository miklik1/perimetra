import { afterEach, describe, expect, it, vi } from "vitest";

import { type Env } from "../../../common/config/env.js";
import { PosthogPurgeHook } from "./posthog.purge.js";

const configured = {
  POSTHOG_HOST: "https://eu.posthog.com",
  POSTHOG_PERSONAL_API_KEY: "phx_key",
  POSTHOG_PROJECT_ID: "42",
} as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PosthogPurgeHook (ADR 1010)", () => {
  it("SKIPS (no fetch) when the personal API key / project id are unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      POSTHOG_HOST: "https://x",
      POSTHOG_PERSONAL_API_KEY: "",
      POSTHOG_PROJECT_ID: "",
    } as unknown as Env;

    const outcome = await new PosthogPurgeHook(env).purgeUser("u-1");

    expect(outcome.status).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PURGES: looks the person up and DELETEs them with events", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: "p-9" }] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await new PosthogPurgeHook(configured).purgeUser("u-1");

    expect(outcome.status).toBe("purged");
    const [delUrl, delInit] = fetchMock.mock.calls[1]! as [string, { method: string }];
    expect(delUrl).toContain("/persons/p-9/");
    expect(delUrl).toContain("delete_events=true");
    expect(delInit.method).toBe("DELETE");
  });

  it("PURGES (idempotent) when no person is found — end-state already holds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await new PosthogPurgeHook(configured).purgeUser("u-1");

    expect(outcome.status).toBe("purged");
    expect(fetchMock).toHaveBeenCalledTimes(1); // no DELETE issued
  });

  it("treats a 404 on deletion as success (already gone)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: "p-9" }] }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await new PosthogPurgeHook(configured).purgeUser("u-1");

    expect(outcome.status).toBe("purged");
  });

  it("THROWS (escalates, never a swallowed outcome) when the person lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));

    await expect(new PosthogPurgeHook(configured).purgeUser("u-1")).rejects.toThrow(
      /lookup failed: 500/,
    );
  });

  it("THROWS (escalates) when the person deletion fails with a non-2xx, non-404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: "p-9" }] }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new PosthogPurgeHook(configured).purgeUser("u-1")).rejects.toThrow(
      /deletion failed: 500/,
    );
  });
});
