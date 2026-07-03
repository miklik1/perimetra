import { describe, expect, it } from "vitest";

import { safeCompare } from "./jobs.module.js";

describe("safeCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("admin", "admin")).toBe(true);
    expect(safeCompare("s3cr3t-password", "s3cr3t-password")).toBe(true);
  });

  it("returns false for a mismatched value of the same length", () => {
    expect(safeCompare("adm1n", "admin")).toBe(false);
  });

  it("returns false for values of different length without throwing", () => {
    // `crypto.timingSafeEqual` throws on mismatched buffer lengths — hashing
    // both sides first is what makes a shorter/longer guess safe to compare.
    expect(() => safeCompare("a", "a-much-longer-expected-password")).not.toThrow();
    expect(safeCompare("a", "a-much-longer-expected-password")).toBe(false);
    expect(safeCompare("", "admin")).toBe(false);
  });
});
