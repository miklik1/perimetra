import { afterEach, describe, expect, it, vi } from "vitest";

import { SentryPurgeHook } from "./sentry.purge.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SentryPurgeHook (ADR 1010)", () => {
  it("reports a first-class 'documented' outcome when SENTRY_DSN is set (no fabricated call)", async () => {
    vi.stubEnv("SENTRY_DSN", "https://k@o.ingest.sentry.io/1");

    const outcome = await new SentryPurgeHook().purgeUser("u-1");

    // Sentry has no per-user server deletion API — the obligation is recorded,
    // never a fabricated call. PII is minimized at source (init.ts scrubber).
    expect(outcome.status).toBe("documented");
    expect(typeof outcome.detail).toBe("string");
  });

  it("reports 'skipped' when SENTRY_DSN is unset", async () => {
    vi.stubEnv("SENTRY_DSN", "");

    const outcome = await new SentryPurgeHook().purgeUser("u-1");

    expect(outcome.status).toBe("skipped");
  });
});
