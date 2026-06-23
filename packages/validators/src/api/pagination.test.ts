import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./pagination";

const uuid = "01890a5d-ac96-774b-bcce-b302099a8057"; // uuidv7-shaped

describe("cursorQuerySchema", () => {
  it("applies defaults when the query is empty", () => {
    expect(cursorQuerySchema.parse({})).toEqual({
      limit: 20,
      sort: "createdAt:desc",
    });
  });

  it("coerces limit from a query-string value", () => {
    expect(cursorQuerySchema.parse({ limit: "50" }).limit).toBe(50);
  });

  it("rejects limit outside 1-100", () => {
    expect(cursorQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(cursorQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("accepts a uuid cursor and rejects a non-uuid one", () => {
    expect(cursorQuerySchema.parse({ cursor: uuid }).cursor).toBe(uuid);
    expect(cursorQuerySchema.safeParse({ cursor: "not-a-uuid" }).success).toBe(false);
  });

  it("coerces an empty-string cursor to undefined (absent query param)", () => {
    const parsed = cursorQuerySchema.parse({ cursor: "" });
    expect(parsed.cursor).toBeUndefined();
  });

  it("accepts only the two createdAt sort values", () => {
    expect(cursorQuerySchema.parse({ sort: "createdAt:asc" }).sort).toBe("createdAt:asc");
    expect(cursorQuerySchema.safeParse({ sort: "name:asc" }).success).toBe(false);
  });

  it("extends with resource-specific filters", () => {
    const listQuery = cursorQuerySchema.extend({
      status: z.enum(["active", "archived"]).optional(),
    });
    expect(listQuery.parse({ status: "archived" })).toEqual({
      limit: 20,
      sort: "createdAt:desc",
      status: "archived",
    });
  });
});

describe("paginated", () => {
  const envelope = paginated(z.object({ id: z.uuid() }));

  it("parses a page with a next cursor", () => {
    expect(envelope.parse({ items: [{ id: uuid }], nextCursor: uuid })).toEqual({
      items: [{ id: uuid }],
      nextCursor: uuid,
    });
  });

  it("parses the final page (nextCursor null, items may be empty)", () => {
    expect(envelope.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("rejects a missing nextCursor", () => {
    expect(envelope.safeParse({ items: [] }).success).toBe(false);
  });

  it("rejects items that fail the item schema", () => {
    expect(envelope.safeParse({ items: [{ id: "nope" }], nextCursor: null }).success).toBe(false);
  });
});
