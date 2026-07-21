import { navCountsResponseSchema, type NavCountsResponse } from "@repo/validators";

import { defineQuery } from "../builders/define-endpoints";
import { type ApiClient } from "../client/create-api-client";
import { keys } from "../keys";

/**
 * Nav endpoints (1c-3), same factory shape as `createAuthQueries` (ADR 0007):
 * bound to an `ApiClient`, returning `queryOptions`. zod parses the envelope at
 * the trust boundary (ADR 0014).
 *
 * Only `navCounts` lives here — the app-shell badge-count probe. It is a pure,
 * PII-free read aggregate, so it is cheap to poll and safe to invalidate off the
 * `org:<id>` realtime channel (the shell re-fetches the truth rather than
 * mutating cache from a push payload).
 */
export function createNavQueries(client: ApiClient) {
  return {
    // GET /v1/me/nav-counts — role-filtered {leads?, quotes?, orders?}. An
    // absent key means "no pill" (the caller cannot see that surface), never 0.
    navCounts: () =>
      defineQuery<NavCountsResponse>(client, {
        queryKey: keys.nav.counts(),
        path: "/v1/me/nav-counts",
        schema: (data) => navCountsResponseSchema.parse(data),
      }),
  };
}
