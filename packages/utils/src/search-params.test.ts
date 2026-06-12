import { describe, expect, it } from "vitest";

import { appendSearchParams, buildSearchParams, stableParams } from "./search-params";

describe("buildSearchParams", () => {
  it("drops null/undefined, coerces scalars, sorts keys", () => {
    const qs = buildSearchParams({ b: 2, a: "x", gone: undefined, empty: null, ok: true });
    expect(qs.toString()).toBe("a=x&b=2&ok=true");
  });

  it("expands arrays into repeated keys", () => {
    const qs = buildSearchParams({ tags: ["a", "b"], n: 1 });
    expect(qs.toString()).toBe("n=1&tags=a&tags=b");
  });
});

describe("appendSearchParams", () => {
  it("appends with ? when the path has no query", () => {
    expect(appendSearchParams("/users", { page: 2 })).toBe("/users?page=2");
  });

  it("appends with & when the path already has a query", () => {
    expect(appendSearchParams("/users?x=1", { page: 2 })).toBe("/users?x=1&page=2");
  });

  it("returns the path unchanged when nothing serializes", () => {
    expect(appendSearchParams("/users", { a: undefined })).toBe("/users");
    expect(appendSearchParams("/users")).toBe("/users");
  });
});

describe("stableParams", () => {
  it("is order-independent and drops nullish", () => {
    expect(stableParams({ b: 2, a: 1, skip: undefined })).toEqual(stableParams({ a: 1, b: 2 }));
    expect(stableParams({ a: 1 })).toEqual({ a: "1" });
  });

  it("keeps non-empty arrays, drops empty ones", () => {
    expect(stableParams({ tags: ["a", null, "b"], none: [null, undefined] })).toEqual({
      tags: ["a", "b"],
    });
  });
});
