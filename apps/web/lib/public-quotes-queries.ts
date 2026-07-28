import { defineMutation } from "@repo/api";
import type { ApiClient } from "@repo/api";
import {
  quoteAcceptanceSchema,
  sharedNabidkaSchema,
  type QuoteAcceptance,
  type SharedNabidka,
} from "@repo/validators";

/**
 * Public (no-session) buyer quote endpoints (ADR 0089, re-carried by ADR 0130)
 * — kept SEPARATE from the authed `createQuotesQueries` so the unauthenticated
 * buyer surface can never accidentally pull a session-scoped query. The
 * unguessable shareToken is the credential (the same-origin proxy forwards no
 * cookie — none is present).
 *
 * All three are MUTATIONS, including the `resolve` read, and that is deliberate:
 * the token must travel in a request BODY rather than a URL (ADR 0130), and
 * `defineQuery` builds a GET-only `queryOptions` that cannot carry one. Using a
 * mutation also keeps the token out of a TanStack `queryKey`, which the devtools
 * render and which some telemetry integrations serialize — the leak this slice
 * closes must not reappear one layer up. Variables = the shareToken string.
 */
export function createPublicQuotesQueries(client: ApiClient) {
  return {
    resolve: () =>
      defineMutation<SharedNabidka, string>(client, {
        method: "POST",
        path: "/v1/quotes/shared/resolve",
        body: (token) => ({ token }),
        schema: (data) => sharedNabidkaSchema.parse(data),
      }),

    accept: () =>
      defineMutation<QuoteAcceptance, string>(client, {
        method: "POST",
        path: "/v1/quotes/shared/accept",
        body: (token) => ({ token }),
        schema: (data) => quoteAcceptanceSchema.parse(data),
      }),

    decline: () =>
      defineMutation<QuoteAcceptance, string>(client, {
        method: "POST",
        path: "/v1/quotes/shared/decline",
        body: (token) => ({ token }),
        schema: (data) => quoteAcceptanceSchema.parse(data),
      }),
  };
}
