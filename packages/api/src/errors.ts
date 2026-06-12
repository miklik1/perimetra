import { ApiError } from "./client/create-api-client";

/**
 * Status taxonomy + retryability helpers over the normalized {@link ApiError}.
 * Server-safe (no React, no platform deps) so transport middleware, retry
 * policy, and form handlers all classify failures the same way (ADR 0014).
 *
 * Each predicate narrows `unknown`, so call sites can pass a caught error
 * directly without a prior `instanceof` guard.
 */

/** A `4xx`/`5xx` HTTP failure (not a network/parse error). */
export function isHttpError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.kind === "http";
}

export function isUnauthorized(error: unknown): boolean {
  return isHttpError(error) && error.status === 401;
}

export function isForbidden(error: unknown): boolean {
  return isHttpError(error) && error.status === 403;
}

export function isNotFound(error: unknown): boolean {
  return isHttpError(error) && error.status === 404;
}

export function isConflict(error: unknown): boolean {
  return isHttpError(error) && error.status === 409;
}

/** `422 Unprocessable Entity` — the canonical field-validation status. */
export function isValidation(error: unknown): boolean {
  return isHttpError(error) && error.status === 422;
}

export function isRateLimited(error: unknown): boolean {
  return isHttpError(error) && error.status === 429;
}

export function isServerError(error: unknown): boolean {
  return isHttpError(error) && error.status >= 500;
}

/**
 * Whether an HTTP status is worth retrying: `429` or `5xx`. The single source
 * for this rule — used by both `isRetryable` (on `ApiError.status`) and the
 * retry middleware (on a raw `Response.status`), so they can't drift.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Whether a failure is worth retrying: transport (network) errors and retryable
 * statuses (`5xx`/`429`). Never other `4xx` — those won't change on retry. Note
 * this does NOT consider the HTTP method; the retry middleware additionally
 * gates on idempotency so mutations are never replayed.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.kind === "network") return true;
    if (error.kind === "http") return isRetryableStatus(error.status);
    return false; // parse errors are deterministic
  }
  return false;
}

/**
 * The server-advised retry delay in milliseconds (parsed from `Retry-After`),
 * when present on the error. The retry middleware prefers this over its own
 * backoff.
 */
export function retryAfterMs(error: unknown): number | undefined {
  return error instanceof ApiError ? error.retryAfterMs : undefined;
}

/**
 * Field-level validation errors keyed by form field, when the error carried
 * them. Hand to RHF `setError` (ADR 0009).
 */
export function fieldErrors(error: unknown): Record<string, string[]> | undefined {
  return error instanceof ApiError ? error.fieldErrors : undefined;
}

/**
 * The `ApiError` fields worth attaching as observability context
 * (`{ kind, status, code, fieldErrors }`), or `undefined` for non-API errors.
 * Single-homes the field list next to the class so every capture site —
 * QueryClient `onError` hooks, error boundaries — stays in sync when
 * `ApiError` grows a field. Returns a plain record: `@repo/api` stays
 * telemetry-agnostic (ADR 0021 — the app feeds this to `captureException`).
 * Deliberately excludes `body` (may carry user input; the telemetry scrubber
 * is the backstop, not the budget).
 */
export function errorContext(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return {
    kind: error.kind,
    status: error.status,
    code: error.code,
    fieldErrors: error.fieldErrors,
  };
}
