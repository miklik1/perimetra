import { describe, expect, it } from "vitest";

import { keys } from "./keys";

describe("query-key factory", () => {
  it("builds hierarchical keys", () => {
    expect(keys.users.all).toEqual(["users"]);
    expect(keys.users.detail("x")).toEqual(["users", "detail", "x"]);
    expect(keys.users.list()).toEqual(["users", "list", {}]);
    expect(keys.users.list({ q: "a" })).toEqual(["users", "list", { q: "a" }]);
  });

  it("produces an order-independent list key", () => {
    expect(keys.users.list({ a: "1", b: "2" })).toEqual(keys.users.list({ b: "2", a: "1" }));
  });

  it("nests the parent prefix for invalidation", () => {
    const detail = keys.users.detail("x");
    expect(detail.slice(0, keys.users.all.length)).toEqual([...keys.users.all]);
  });
});
