import { describe, expect, it } from "vitest";

import { apiErrorEnvelopeSchema } from "./api-error";

describe("apiErrorEnvelopeSchema", () => {
  it("parses a minimal envelope", () => {
    expect(apiErrorEnvelopeSchema.parse({ message: "bad" })).toEqual({ message: "bad" });
  });

  it("keeps optional code and details", () => {
    const env = { message: "bad", code: "E_X", details: { field: "x" } };
    expect(apiErrorEnvelopeSchema.parse(env)).toEqual(env);
  });

  it("rejects a non-string message", () => {
    expect(apiErrorEnvelopeSchema.safeParse({ message: 123 }).success).toBe(false);
  });
});
