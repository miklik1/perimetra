import { meResponseSchema, type MeResponse } from "@repo/validators";

import { defineQuery } from "../builders/define-endpoints";
import { type ApiClient } from "../client/create-api-client";
import { keys } from "../keys";

/**
 * Auth endpoints, same factory shape as `createUsersQueries` (ADR 0007): bound to
 * an `ApiClient`, carrying no transport state, returning `queryOptions` /
 * `mutationOptions`. zod parses the envelopes at the trust boundary (ADR 0014).
 *
 * Only `me` lives here — the session-validation probe the UI consumes via
 * TanStack. Sign-in, `/auth/refresh` and `/auth/logout` are NOT here: sign-in
 * runs through `@repo/auth`'s Better Auth client (`authClient.signIn.email`,
 * ADR 0033) and refresh/logout are issued by `@repo/auth` outside the wrapped
 * client. This keeps `@repo/api` auth-agnostic (no dependency on `@repo/auth`;
 * the edge runs the other way).
 */
export function createAuthQueries(client: ApiClient) {
  return {
    // GET /v1/me — the real API's URI-versioned route (the un-versioned "/me"
    // 404s against the backend; caught by the real-stack smoke E2E). The
    // session-validation probe — runs through the refresh middleware, so a
    // stale access token is transparently re-minted.
    me: () =>
      defineQuery<MeResponse>(client, {
        queryKey: keys.auth.me(),
        path: "/v1/me",
        // Carries the active-org role (ADR 0056) — the FE role mirror reads it here.
        schema: (data) => meResponseSchema.parse(data),
      }),
  };
}
