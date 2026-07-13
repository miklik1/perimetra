import { describe, expect, it } from "vitest";

import { APP_NAME, DEFAULT_RETRY, STALE_TIME_MS } from "./constants";

describe("constants", () => {
  it("exposes the query defaults consumed by @repo/api", () => {
    expect(STALE_TIME_MS).toBe(60_000);
    expect(DEFAULT_RETRY).toBe(1);
  });

  it("exposes app identity constants", () => {
    expect(APP_NAME).toBeTypeOf("string");
  });
});
