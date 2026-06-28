import { describe, expect, it } from "vitest";

import { loginResponseSchema, loginSchema } from "./auth";

const validUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "a@b.com",
  name: "Ada",
  createdAt: "2026-05-26T00:00:00.000Z",
};

describe("loginSchema", () => {
  it("parses valid credentials", () => {
    expect(loginSchema.parse({ email: "a@b.com", password: "secret" })).toEqual({
      email: "a@b.com",
      password: "secret",
    });
  });

  it("rejects a bad email", () => {
    const r = loginSchema.safeParse({ email: "nope", password: "secret" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["email"]);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("loginResponseSchema", () => {
  it("parses the login envelope (accessToken + user)", () => {
    const parsed = loginResponseSchema.parse({
      success: true,
      data: { accessToken: "jwt.token.here", user: validUser },
    });
    expect(parsed.data.accessToken).toBe("jwt.token.here");
    expect(parsed.data.user).toEqual(validUser);
  });

  it("rejects a malformed user in the envelope", () => {
    const r = loginResponseSchema.safeParse({
      success: true,
      data: { accessToken: "t", user: { ...validUser, email: "nope" } },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty accessToken", () => {
    const r = loginResponseSchema.safeParse({
      success: true,
      data: { accessToken: "", user: validUser },
    });
    expect(r.success).toBe(false);
  });
});
