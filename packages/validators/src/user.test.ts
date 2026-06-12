import { describe, expect, it } from "vitest";

import { createUserSchema, userListSchema, userSchema } from "./user";

const valid = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "a@b.com",
  name: "Ada",
  createdAt: "2026-05-26T00:00:00.000Z",
};

describe("userSchema", () => {
  it("parses a valid user", () => {
    expect(userSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a bad email", () => {
    const r = userSchema.safeParse({ ...valid, email: "nope" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["email"]);
  });

  it("rejects an empty name", () => {
    expect(userSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });
});

describe("userListSchema", () => {
  it("parses an array of users", () => {
    expect(userListSchema.parse([valid])).toHaveLength(1);
  });
});

describe("createUserSchema", () => {
  it("keeps only the client-supplied fields (no id / createdAt)", () => {
    const parsed = createUserSchema.parse({
      name: "Ada",
      email: "a@b.com",
      id: "ignored",
      createdAt: "ignored",
    });
    expect(parsed).toEqual({ name: "Ada", email: "a@b.com" });
  });

  it("enforces the same email + name contracts as userSchema", () => {
    expect(createUserSchema.safeParse({ name: "Ada", email: "nope" }).success).toBe(false);
    expect(createUserSchema.safeParse({ name: "", email: "a@b.com" }).success).toBe(false);
  });
});
