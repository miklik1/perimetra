import { defineMutation } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { quoteAcceptanceSchema, type QuoteAcceptance } from "@repo/validators";

/**
 * Public (no-session) buyer quote endpoints (ADR 0089) — kept SEPARATE from the
 * authed `createQuotesQueries` so the unauthenticated buyer surface can never
 * accidentally pull a session-scoped query. The unguessable shareToken is the
 * credential (the same-origin proxy forwards no cookie — none is present). The
 * GET-by-token read is done server-side (RSC); only the accept/decline mutations
 * live here. Variables = the shareToken string.
 */
export function createPublicQuotesQueries(client: ApiClient) {
  return {
    accept: () =>
      defineMutation<QuoteAcceptance, string>(client, {
        method: "POST",
        path: (token) => `/v1/quotes/shared/${token}/accept`,
        body: () => undefined,
        schema: (data) => quoteAcceptanceSchema.parse(data),
      }),

    decline: () =>
      defineMutation<QuoteAcceptance, string>(client, {
        method: "POST",
        path: (token) => `/v1/quotes/shared/${token}/decline`,
        body: () => undefined,
        schema: (data) => quoteAcceptanceSchema.parse(data),
      }),
  };
}
