import { describe, expect, it } from "vitest";

import { isActive, matchRoute } from "./active";

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
});
