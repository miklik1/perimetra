import {
  ApiError,
  isConflict,
  isForbidden,
  isNotFound,
  isRateLimited,
  isServerError,
  isUnauthorized,
  isValidation,
} from "@repo/api";
import type { Issue } from "@repo/engine";

/**
 * The user-facing error-message catalog (critic gap: "no user-facing
 * error-message catalog"). Maps an unknown caught error to a key in the
 * `errors.*` i18n namespace so the UI shows translated, human copy instead of
 * raw `error.name`/`error.message` / `ParseError`/`ZodError` text.
 *
 * It returns a translation KEY, not a string — the component resolves it via
 * `useTranslations("errors")`, keeping this module React- and locale-agnostic
 * (it runs the same on the server-rendered error boundary and client leaves).
 *
 * The mapping leans on the `@repo/api` taxonomy (ADR 0014) so every surface
 * classifies failures identically: 401 → unauthorized, 403 → forbidden, etc.
 * Anything unrecognised falls back to `generic`.
 */
export type ErrorMessageKey =
  | "generic"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "validation"
  | "rateLimited"
  | "server";

export function errorMessageKey(error: unknown): ErrorMessageKey {
  if (error instanceof ApiError && error.kind === "network") return "network";
  if (isUnauthorized(error)) return "unauthorized";
  if (isForbidden(error)) return "forbidden";
  if (isNotFound(error)) return "notFound";
  if (isConflict(error)) return "conflict";
  if (isValidation(error)) return "validation";
  if (isRateLimited(error)) return "rateLimited";
  if (isServerError(error)) return "server";
  // Parse errors and any non-API error: a generic message to the user. The raw
  // detail (ZodError text, stack) never reaches production UI — it's surfaced
  // only by `devErrorDetail` below, gated to development.
  return "generic";
}

/**
 * The typed I5 engine issues carried by a 422 `site_invalid` rejection at the
 * selling moment (CAR-162). The engine's rejection body is
 * `{ code: "site_invalid", issues: Issue[] }`; sibling 422s (`margin_below_floor`,
 * `margin_floor_without_cost`) carry NO `issues`, so those return `undefined`
 * here and fall through to the generic `errorMessageKey` toast. Returns the
 * issues so the caller can render them human-readable (Czech) via `formatIssue`
 * / `IssueList` — no blank screen, no swallowed error.
 */
export function siteInvalidIssues(error: unknown): Issue[] | undefined {
  if (!(error instanceof ApiError) || !isValidation(error)) return undefined;
  const body = error.body as { code?: unknown; issues?: unknown } | null | undefined;
  if (body?.code !== "site_invalid" || !Array.isArray(body.issues) || body.issues.length === 0) {
    return undefined;
  }
  return body.issues as Issue[];
}

/**
 * The raw, untranslated detail (`name: message`) for a caught error — returned
 * ONLY in development so a dev sees the underlying cause inline. In production
 * it returns `undefined` so the UI shows only the mapped, translated message.
 * Components render it as small, muted dev-only text beneath the user message.
 */
export function devErrorDetail(error: unknown): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return undefined;
}

/**
 * Maps a Better Auth client failure onto the same `errors.*` catalog. The
 * Better Auth client returns `{ error: { status, code, message } }` values —
 * never `ApiError` instances — so the taxonomy guards above don't apply; the
 * login form re-throws that value (app/login/login-form.tsx) and this maps it
 * by status. A 401 from sign-in means BAD CREDENTIALS, not an expired session,
 * so it maps to `validation` ("check the details you entered"), not
 * `unauthorized` ("session expired").
 */
export function authErrorMessageKey(error: unknown): ErrorMessageKey {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return "generic";
  if (status === 0) return "network";
  if (status === 400 || status === 401 || status === 422) return "validation";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "server";
  return "generic";
}
