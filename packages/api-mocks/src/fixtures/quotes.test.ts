import { describe, expect, it } from "vitest";

import { sharedNabidkaSchema } from "@repo/validators";

import { findSharedNabidkaFixture } from "./quotes";

/**
 * Mock↔contract parity (ADR 0089): the buyer route parses the GET-by-token
 * response through `sharedNabidkaSchema`, so the mock fixture MUST satisfy it or
 * mock-mode dev silently 404s. This locks the parity the real API gets for free
 * (its `@ZodSerializerDto`). Covers both the standard-VAT and §92e seeds.
 */
describe("findSharedNabidkaFixture mock parity", () => {
  it("returns a payload that satisfies sharedNabidkaSchema (standard VAT)", () => {
    const result = sharedNabidkaSchema.safeParse(findSharedNabidkaFixture("share-000000000001"));
    expect(result.success).toBe(true);
  });

  it("returns a §92e (reverse-charge) document that satisfies the schema, with the legend", () => {
    const found = findSharedNabidkaFixture("share-000000000002");
    const result = sharedNabidkaSchema.safeParse(found);
    expect(result.success).toBe(true);
    expect(found?.document.tax.mode).toBe("reverse_charge_92e");
    expect(found?.document.legend).toBeDefined();
  });

  it("never carries cost/stamp keys (mirrors the real boundary)", () => {
    const raw = JSON.stringify(findSharedNabidkaFixture("share-000000000001"));
    expect(raw).not.toContain("costMoney");
    expect(raw).not.toContain("stamps");
    expect(raw).not.toContain("releaseIds");
  });

  it("returns undefined for an unknown shareToken", () => {
    expect(findSharedNabidkaFixture("no-such-token")).toBeUndefined();
  });

  // ADR-O1/CAR-158: a superseded quote's `status` is untouched (supersession is
  // a separate pointer) — the buyer route must still report the real effective
  // status AND flag `superseded`, never conflate the two.
  it("flags a superseded quote's status as unchanged, with superseded true", () => {
    const found = findSharedNabidkaFixture("share-000000000005");
    const result = sharedNabidkaSchema.safeParse(found);
    expect(result.success).toBe(true);
    expect(found?.status).toBe("issued");
    expect(found?.superseded).toBe(true);
  });
});
