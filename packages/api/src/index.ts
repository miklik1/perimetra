// Stable public barrel. App code imports only from `@repo/api` and never knows
// whether a contract is hand-written or generated (ADR 0007).
export { createApiClient, ApiError, parseRetryAfter } from "./client/create-api-client";
export {
  isHttpError,
  isUnauthorized,
  isForbidden,
  isNotFound,
  isConflict,
  isValidation,
  isRateLimited,
  isServerError,
  isRetryable,
  isRetryableStatus,
  retryAfterMs,
  fieldErrors,
  errorContext,
} from "./errors";
export type {
  ApiClient,
  ApiClientConfig,
  ApiMiddleware,
  ApiRequest,
  ApiFetchOptions,
  ApiErrorKind,
  ResponseEnvelopeConfig,
} from "./client/create-api-client";
export { createRetryMiddleware } from "./middleware/retry";
export type { RetryOptions } from "./middleware/retry";
export { createDebugMiddleware } from "./middleware/debug";
export type { DebugMiddlewareOptions } from "./middleware/debug";
export { getApiLog, clearApiLog } from "./middleware/api-log-store";
export type { ApiLogEntry } from "./middleware/api-log-store";
export { makeQueryClient, getQueryClient } from "./client/query-client";
export type { MakeQueryClientOptions } from "./client/query-client";
export { keys } from "./keys";
export { queryOptions, mutationOptions } from "./query-helpers";
export { invalidateKeys } from "./cache/invalidation";
export { optimisticUpdate } from "./cache/optimistic";
export type { OptimisticConfig, OptimisticContext } from "./cache/optimistic";
export { defineQuery, defineMutation, defineInfiniteQuery } from "./builders/define-endpoints";
export type {
  DefineQueryConfig,
  DefineMutationConfig,
  DefineInfiniteQueryConfig,
} from "./builders/define-endpoints";
export { createUsersQueries } from "./endpoints/users";
export { createAuthQueries } from "./endpoints/auth";
// @gen:exports — `pnpm gen api-resource` adds the resource endpoint export here.
// RSC-safe hydration utilities (no client state). The React client surface —
// provider + hooks — lives behind the `"use client"` boundary in `./react`
// (`@repo/api/react`) and is intentionally NOT re-exported here.
export { dehydrate, HydrationBoundary } from "@tanstack/react-query";
