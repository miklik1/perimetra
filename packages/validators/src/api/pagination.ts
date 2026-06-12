import { z } from "zod";

/**
 * Keyset-pagination contracts (spec §8, ADR 0030): every list endpoint speaks
 * the same envelope and the same cursor query pieces, so clients paginate any
 * resource with one helper. Cursors are row ids — uuidv7 IS creation order,
 * so paging "by id" pages by createdAt without a composite cursor.
 */

/** Cursor = the id of the last row of the previous page (uuidv7). */
export const cursorSchema = z.uuid();

/** Page size: 1-100, defaults to 20 — bounded so a client can't ask for the table. */
export const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

/**
 * Sort contract for list endpoints. uuidv7 ids are time-ordered, so
 * `createdAt:*` translates to `ORDER BY id` server-side (index-friendly,
 * stable under inserts).
 */
export const listSortSchema = z.enum(["createdAt:asc", "createdAt:desc"]).default("createdAt:desc");

export type ListSort = z.infer<typeof listSortSchema>;

/**
 * The shared `{ cursor, limit, sort }` building block for resource list
 * queries — `.extend()` it with resource-specific filters:
 *
 * ```ts
 * export const listProjectsQuerySchema = cursorQuerySchema.extend({
 *   status: z.enum(["active", "archived"]).optional(),
 * });
 * ```
 *
 * `limit` is coerced (query params arrive as strings); `limit`/`sort` carry
 * defaults so the parsed output always has them.
 */
export const cursorQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: limitSchema,
  sort: listSortSchema,
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/**
 * Paginated response envelope: `{ items, nextCursor }`. `nextCursor` is the id
 * of the last item when more rows exist, `null` on the final page — clients
 * loop `while (nextCursor !== null)`.
 */
export function paginated<TItem extends z.ZodType>(itemSchema: TItem) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.uuid().nullable(),
  });
}

export type Paginated<TItem> = {
  items: TItem[];
  nextCursor: string | null;
};
