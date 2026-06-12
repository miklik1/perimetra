import { describe, expect, it } from "vitest";

import { pii, piiColumnNames, piiColumns } from "./pii.js";

describe("pii registry", () => {
  it("returns the column unchanged and records the qualified name", () => {
    const column = { marker: true };
    expect(pii("users.email", column)).toBe(column);
    expect(piiColumns()).toContain("users.email");
  });

  it("dedupes bare column names across tables", () => {
    pii("users.email", {});
    pii("contacts.email", {});
    expect(piiColumnNames().filter((name) => name === "email")).toHaveLength(1);
  });
});
