import { describe, expect, it } from "vitest";

import { parseSearchParams, searchParamsToRecord } from "./search";

describe("searchParamsToRecord", () => {
  it("collapses single keys to strings and repeated keys to arrays", () => {
    const record = searchParamsToRecord(new URLSearchParams("a=1&tags=x&tags=y"));
    expect(record).toEqual({ a: "1", tags: ["x", "y"] });
  });

  it("returns an empty record for an empty query", () => {
    expect(searchParamsToRecord(new URLSearchParams(""))).toEqual({});
  });
});

describe("parseSearchParams", () => {
  it("coerces and applies defaults through the route schema", () => {
    expect(parseSearchParams("users", { page: "3", sort: "name" })).toEqual({
      page: 3,
      sort: "name",
    });
    expect(parseSearchParams("users", {})).toEqual({ page: 1 });
  });

  it("falls back per key on garbage input instead of throwing", () => {
    // page is unparseable → its default; the valid sort survives.
    expect(parseSearchParams("users", { page: "abc", sort: "name" })).toEqual({
      page: 1,
      sort: "name",
    });
    // invalid enum value → dropped; page survives.
    expect(parseSearchParams("users", { page: "2", sort: "bogus" })).toEqual({ page: 2 });
  });

  it("falls back to default when a numeric param is repeated (array input)", () => {
    // ?page=1&page=2 → { page: ["1","2"] } → numeric coercion yields NaN → the
    // key is dropped and its default (1) re-applied; the valid sort survives.
    expect(parseSearchParams("users", { page: ["1", "2"], sort: "name" })).toEqual({
      page: 1,
      sort: "name",
    });
  });

  it("ignores unknown keys (zod strips by default)", () => {
    expect(parseSearchParams("users", { page: "2", utm_source: "x" })).toEqual({ page: 2 });
  });

  it("parses to an empty object for routes without a search schema", () => {
    expect(parseSearchParams("home", { anything: "1" })).toEqual({});
  });
});
