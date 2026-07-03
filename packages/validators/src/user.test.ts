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

  it("accepts a Better Auth-style (non-uuid) id", () => {
    // Regression: the real backend's user ids are 32-char nanoid-style, not
    // uuids — the old z.uuid() contract rejected them and GET /v1/me rendered
    // an empty account. The mock fixtures' uuids masked it.
    const r = userSchema.safeParse({ ...valid, id: "8vTaS4kqGR0y1lZ2wXbN9pCfHdEuMoQ7" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty id", () => {
    expect(userSchema.safeParse({ ...valid, id: "" }).success).toBe(false);
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
