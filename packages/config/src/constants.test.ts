import { describe, expect, it } from "vitest";

import { ACCESS_TOKEN_TTL_MS, APP_NAME, DEFAULT_RETRY, STALE_TIME_MS } from "./constants";

describe("constants", () => {
  it("exposes the query defaults consumed by @repo/api", () => {
    expect(STALE_TIME_MS).toBe(60_000);
    expect(DEFAULT_RETRY).toBe(1);
  });

  it("exposes app identity constants", () => {
    expect(APP_NAME).toBeTypeOf("string");
  });

  it("exposes the access-token lifetime consumed by the web MSW mock (ADR 0016)", () => {
    expect(ACCESS_TOKEN_TTL_MS).toBe(900_000);
  });
});
