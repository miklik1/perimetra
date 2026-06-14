import {
  loginResponseSchema,
  meResponseSchema,
  type LoginInput,
  type LoginResponse,
  type MeResponse,
} from "@repo/validators";

import { defineMutation, defineQuery } from "../builders/define-endpoints";
import { type ApiClient } from "../client/create-api-client";
import { keys } from "../keys";

/**
 * Auth endpoints, same factory shape as `createUsersQueries` (ADR 0007): bound to
 * an `ApiClient`, carrying no transport state, returning `queryOptions` /
 * `mutationOptions`. zod parses the envelopes at the trust boundary (ADR 0014).
 *
 * Only `login` and `me` live here — the request/response shapes the UI consumes
 * via TanStack. `/auth/refresh` and `/auth/logout` are NOT here: they're issued
 * by `@repo/auth` (token refresh middleware, logout helper) via a bare `fetch`,
 * deliberately outside the wrapped client so refresh can't re-enter the 401
 * interceptor. This keeps `@repo/api` auth-agnostic (no dependency on
 * `@repo/auth`; the edge runs the other way).
 */
export function createAuthQueries(client: ApiClient) {
  return {
    // POST /auth/login. Returns the access token + user; the caller (login form)
    // writes the token to `@repo/auth`'s token-manager and the user to the store.
    login: () =>
      defineMutation<LoginResponse, LoginInput>(client, {
        method: "POST",
        path: "/auth/login",
        schema: (data) => loginResponseSchema.parse(data),
      }),
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
