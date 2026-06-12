import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_TTL_MS,
  APP_NAME,
  DEFAULT_RETRY,
  REFRESH_PROACTIVE_BUFFER_MS,
  SESSION_MONITOR_INTERVAL_MS,
  STALE_TIME_MS,
} from "./constants";

describe("constants", () => {
  it("exposes the query defaults consumed by @repo/api", () => {
    expect(STALE_TIME_MS).toBe(60_000);
    expect(DEFAULT_RETRY).toBe(1);
  });

  it("exposes app identity constants", () => {
    expect(APP_NAME).toBeTypeOf("string");
  });

  it("exposes auth token lifetimes consumed by @repo/auth (ADR 0016)", () => {
    expect(ACCESS_TOKEN_TTL_MS).toBe(900_000);
    expect(REFRESH_PROACTIVE_BUFFER_MS).toBe(120_000);
    expect(SESSION_MONITOR_INTERVAL_MS).toBe(60_000);
    // The proactive buffer must be shorter than the token lifetime, else
    // SessionMonitor would refresh on every tick.
    expect(REFRESH_PROACTIVE_BUFFER_MS).toBeLessThan(ACCESS_TOKEN_TTL_MS);
  });
});
