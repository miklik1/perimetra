import { describe, expect, it } from "vitest";

import { buildPath, routes, type Href } from "./index";

describe("buildPath", () => {
  it("returns the literal template for a paramless route", () => {
    expect(buildPath({ route: "home" })).toBe("/");
    expect(buildPath({ route: "users" })).toBe("/users");
  });

  it("substitutes :id from params", () => {
    expect(buildPath({ route: "user", params: { id: "42" } })).toBe("/users/42");
  });

  it("URL-encodes param values", () => {
    expect(buildPath({ route: "user", params: { id: "a b/c" } })).toBe("/users/a%20b%2Fc");
  });

  it("throws on an unknown route", () => {
    expect(() => buildPath({ route: "ghost" as never } as Href)).toThrow(/Unknown route/);
  });

  it("placeholder matching is boundary-anchored (`:i` must not match inside `:id`)", () => {
    // A substring check would silently substitute into ":id" and corrupt the
    // path; the anchored matcher rejects the unknown param instead.
    expect(() => buildPath({ route: "user", params: { i: "v" } as never } as Href)).toThrow(
      /has no param ":i"/,
    );
  });

  it("throws on an empty param value (would silently yield `/users/`)", () => {
    expect(() => buildPath({ route: "user", params: { id: "" } })).toThrow(/cannot be empty/);
  });

  it("serializes a typed query with stable (sorted) key order", () => {
    expect(buildPath({ route: "users", query: { page: 2 } })).toBe("/users?page=2");
    expect(buildPath({ route: "users", query: { sort: "name", page: 2 } })).toBe(
      "/users?page=2&sort=name",
    );
  });

  it("omits the query string when nothing survives serialization", () => {
    expect(buildPath({ route: "users", query: {} })).toBe("/users");
    expect(buildPath({ route: "users", query: { page: undefined } })).toBe("/users");
  });

  it("type-rejects missing params (compile-time)", () => {
    // @ts-expect-error — `user` requires `params: { id: string }`.
    const _missing: Href = { route: "user" };
    // @ts-expect-error — `home` does not accept `params`.
    const _extra: Href = { route: "home", params: { id: "1" } };
    // @ts-expect-error — unknown route name.
    const _typo: Href = { route: "userz" };
    void _missing;
    void _extra;
    void _typo;
  });

  it("type-rejects query misuse (compile-time)", () => {
    // @ts-expect-error — `home` has no search schema, so no `query`.
    const _noSchema: Href = { route: "home", query: { page: 1 } };
    // @ts-expect-error — `sort` is an enum of "name" | "date".
    const _badValue: Href = { route: "users", query: { sort: "bogus" } };
    // @ts-expect-error — unknown query key.
    const _badKey: Href = { route: "users", query: { pgae: 1 } };
    void _noSchema;
    void _badValue;
    void _badKey;
  });

  it("exposes the const-asserted registry", () => {
    expect(routes.user.path).toBe("/users/:id");
    expect(routes.user.params.id).toBe("string");
  });
});
