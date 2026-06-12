import { describe, expect, it } from "vitest";

import { assert, assertNever, isDefined } from "./assert";

describe("assert", () => {
  it("throws on falsy with the given message", () => {
    expect(() => assert(false, "must be set")).toThrow("must be set");
    expect(() => assert(0, "zero")).toThrow("zero");
  });

  it("passes on truthy", () => {
    expect(() => assert(1, "ok")).not.toThrow();
  });
});

describe("assertNever", () => {
  it("always throws", () => {
    expect(() => assertNever("x" as never)).toThrow(/Unexpected value: x/);
  });
});

describe("isDefined", () => {
  it("narrows away null and undefined", () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined("")).toBe(true);
    expect(isDefined(null)).toBe(false);
    expect(isDefined(undefined)).toBe(false);
  });
});
