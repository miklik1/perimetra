import { afterEach, describe, expect, it, vi } from "vitest";

import { isActive, matchRoute } from "./active";

afterEach(() => {
  vi.doUnmock("./routes");
  vi.resetModules();
});

/**
 * Load `matchRoute` against a stubbed registry whose keys are supplied in the
 * given order, so two routes that tie on specificity can be tested for an
 * insertion-order-independent winner.
 */
async function matchRouteWith(entries: [string, { path: string }][]) {
  vi.resetModules();
  vi.doMock("./routes", () => ({ routes: Object.fromEntries(entries) }));
  const mod = await import("./active");
  return mod.matchRoute;
}

describe("isActive", () => {
  it("matches static templates exactly", () => {
    expect(isActive("/users", "users")).toBe(true);
    expect(isActive("/users/", "users")).toBe(true); // trailing slash normalized
    expect(isActive("/account", "users")).toBe(false);
  });

  it("matches dynamic segments", () => {
    expect(isActive("/users/42", "user")).toBe(true);
    expect(isActive("/users/a%20b", "user")).toBe(true);
    expect(isActive("/users", "user")).toBe(false);
    expect(isActive("/users/42/extra", "user")).toBe(false);
  });

  it("prefix mode highlights parents while a child is open", () => {
    expect(isActive("/users/42", "users", { exact: false })).toBe(true);
    expect(isActive("/users", "users", { exact: false })).toBe(true);
    expect(isActive("/usersx", "users", { exact: false })).toBe(false);
  });

  it("ignores query and hash", () => {
    expect(isActive("/users?page=2", "users")).toBe(true);
    expect(isActive("/users#top", "users")).toBe(true);
  });

  it("keeps the root exact by default", () => {
    expect(isActive("/", "home")).toBe(true);
    expect(isActive("/users", "home")).toBe(false);
  });
});

describe("matchRoute", () => {
  it("resolves pathnames to their registry route", () => {
    expect(matchRoute("/")).toBe("home");
    expect(matchRoute("/login")).toBe("login");
    expect(matchRoute("/users/42")).toBe("user");
  });

  it("prefers the more specific static template over a dynamic match", () => {
    // "/users" matches both the static `users` template and nothing else —
    // the static one must win even though `user`'s dynamic template exists.
    expect(matchRoute("/users")).toBe("users");
  });

  it("returns null for paths outside the registry", () => {
    expect(matchRoute("/nope")).toBeNull();
    expect(matchRoute("/users/42/extra")).toBeNull();
  });

  it("breaks specificity ties deterministically, independent of registry order", async () => {
    // Two routes share a template (same staticSegments) → a genuine tie. The
    // winner must be the same regardless of registry key order, not whichever
    // key the engine happens to iterate first.
    const forward = await matchRouteWith([
      ["alpha", { path: "/dup" }],
      ["zeta", { path: "/dup" }],
    ]);
    const reversed = await matchRouteWith([
      ["zeta", { path: "/dup" }],
      ["alpha", { path: "/dup" }],
    ]);
    expect(forward("/dup")).toBe("alpha");
    expect(reversed("/dup")).toBe("alpha");
  });
});
