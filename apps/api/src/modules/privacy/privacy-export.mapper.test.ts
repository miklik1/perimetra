import { describe, expect, it } from "vitest";

import { INTERNAL_EXPORT_KEYS, stripInternalColumns } from "./privacy-export.mapper.js";

describe("stripInternalColumns", () => {
  it("drops the default internal columns (ownerId, organizationId, deletedAt)", () => {
    const [out] = stripInternalColumns([
      { id: "r1", name: "x", ownerId: "u1", organizationId: "o1", deletedAt: null },
    ]);
    expect(out).toEqual({ id: "r1", name: "x" });
    // Pin the default set so a future edit can't silently widen/narrow it.
    expect(INTERNAL_EXPORT_KEYS).toEqual(["ownerId", "organizationId", "deletedAt"]);
  });

  it("KEEPS createdAt/updatedAt — legitimate record metadata (Art. 15(1))", () => {
    const [out] = stripInternalColumns([
      {
        id: "r1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
        ownerId: "u1",
      },
    ]);
    expect(out).toHaveProperty("createdAt");
    expect(out).toHaveProperty("updatedAt");
    expect(out).not.toHaveProperty("ownerId");
  });

  it("drops a module-specific internal/actor FK passed via `also` (e.g. createdByUserId)", () => {
    const [out] = stripInternalColumns(
      [{ id: "f1", name: "row", createdByUserId: "u1", organizationId: "o1" }],
      ["createdByUserId"],
    );
    expect(out).toEqual({ id: "f1", name: "row" });
  });

  it("rescues a default-internal key via `keep` (meaningful payload in context)", () => {
    const [out] = stripInternalColumns(
      [{ id: "m1", organizationId: "org1", ownerId: "u1", role: "owner" }],
      [],
      ["organizationId"],
    );
    // organizationId rescued (the only thing distinguishing the rows here);
    // ownerId still dropped (redundant with the export envelope's userId).
    expect(out).toEqual({ id: "m1", organizationId: "org1", role: "owner" });
  });

  it("is a no-op for an absent key (the same default set is safe on every table)", () => {
    expect(stripInternalColumns([{ id: "r1", value: 42 }])).toEqual([{ id: "r1", value: 42 }]);
  });

  it("does not mutate the input rows", () => {
    const rows = [{ id: "r1", ownerId: "u1" }];
    stripInternalColumns(rows);
    expect(rows[0]).toEqual({ id: "r1", ownerId: "u1" });
  });

  it("returns [] for an empty input", () => {
    expect(stripInternalColumns([])).toEqual([]);
  });
});
