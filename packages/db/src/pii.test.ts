import { describe, expect, it } from "vitest";

import { pii, piiBodyKeys, piiColumnNames, piiColumns } from "./pii.js";

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

  it("piiBodyKeys emits BOTH snake_case and camelCase for a multi-word column", () => {
    // The redaction sinks match against camelCase body / Drizzle-row keys; a
    // snake-only path silently no-ops. Both forms must be present.
    pii("session.ip_address", {});
    const keys = piiBodyKeys();
    expect(keys).toContain("ip_address");
    expect(keys).toContain("ipAddress");
  });

  it("piiBodyKeys collapses a single-word column to one entry", () => {
    pii("users.email", {});
    expect(piiBodyKeys().filter((k) => k === "email")).toHaveLength(1);
  });
});
