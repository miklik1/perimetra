import { describe, expect, it } from "vitest";

import { id, softDelete, timestamps } from "./columns.js";

describe("column helpers", () => {
  it("id() generates time-ordered UUIDv7 defaults", () => {
    const column = id();
    // Drizzle exposes the app-side default via the builder config.
    const config = (column as unknown as { config: { defaultFn?: () => string } }).config;
    const a = config.defaultFn!();
    const b = config.defaultFn!();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // UUIDv7 is time-ordered: later generation sorts later.
    expect(b > a).toBe(true);
  });

  it("timestamps() exposes created_at/updated_at", () => {
    const cols = timestamps();
    expect(Object.keys(cols)).toEqual(["createdAt", "updatedAt"]);
  });

  it("softDelete() exposes deleted_at", () => {
    expect(Object.keys(softDelete())).toEqual(["deletedAt"]);
  });
});
