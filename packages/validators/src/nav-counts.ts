import { z } from "zod";

/**
 * `GET /v1/me/nav-counts` (1c-3) — the badge counts the authenticated app shell
 * paints on its nav entries (design/README.md §4.1). Every key is OPTIONAL and
 * ROLE-FILTERED server-side: a key is present only when the caller may see that
 * surface (the shell shows the priced `quotes` pill to admin/sales, `orders` to
 * any member), so an absent key means "no pill", never "zero" — an empty pill is
 * worse than none (§4.1).
 *
 *  - `leads`  — reserved: the leads module does not exist yet, so the endpoint
 *               never emits it (the registry carries the `countKey` ahead of the
 *               source). Kept in the contract so wiring it later is additive.
 *  - `quotes` — open quotes needing attention: stored status `draft` + `issued`
 *               (a lapsed/expired issued quote stays counted — it is still
 *               actionable/reviseable; `expired` is a derived read, not a stored
 *               status). admin/sales only; a `sales` caller is narrowed to their
 *               own quotes (ADR 0082), admin sees the whole org.
 *  - `orders` — the live build queue: stored status `confirmed` + `in_production`
 *               (`completed`/`cancelled` are terminal). Any org member.
 *
 * Counts are non-negative integers. This is a pure read aggregate — no PII, no
 * entity bodies — so it is cheap to poll and safe to invalidate off realtime.
 */
export const navCountsResponseSchema = z.object({
  leads: z.number().int().nonnegative().optional(),
  quotes: z.number().int().nonnegative().optional(),
  orders: z.number().int().nonnegative().optional(),
});
export type NavCountsResponse = z.infer<typeof navCountsResponseSchema>;
