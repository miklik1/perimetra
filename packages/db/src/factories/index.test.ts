import { describe, expect, it } from "vitest";

import { defineFactory } from "./index.js";

describe("defineFactory", () => {
  it("produces sequenced defaults with overrides", () => {
    const makeUser = defineFactory((seq) => ({
      email: `user-${seq}@example.test`,
      name: `User ${seq}`,
    }));

    expect(makeUser()).toEqual({
      email: "user-0@example.test",
      name: "User 0",
    });
    expect(makeUser({ name: "Alice" })).toEqual({
      email: "user-1@example.test",
      name: "Alice",
    });
  });
});
