/**
 * Platform-neutral shared constants. Safe to import from any bundle (no env,
 * no platform-specific code). `STALE_TIME_MS` / `DEFAULT_RETRY` are the single
 * source for the TanStack Query defaults consumed by `@repo/api`.
 */
export const APP_NAME = "fullstack-skeleton";

// Locale + currency identity moved to @repo/i18n (ADR 0020): they were dead here
// and "who owns locale/currency" now has a coherent home. `DEFAULT_LOCALE` and
// `DEFAULT_CURRENCY` live in `@repo/i18n` (cs-first); the pure-leaf formatter
// fallback is `@repo/utils` `FALLBACK_LOCALE`.

export const STALE_TIME_MS = 60_000;

export const DEFAULT_RETRY = 1;

/**
 * Per-resource cache tiers (TanStack `staleTime`). A resource's volatility — not
 * a single global — should pick its freshness window. The skeleton's global
 * default is `STALE.FRESH` (= `STALE_TIME_MS`); endpoints opt into another tier
 * via the builder's `staleTime`. Tune these once here, app-wide.
 */
export const STALE = {
  /** Effectively immutable for a session: footers, static config. */
  STATIC: 30 * 60_000,
  /** Changes rarely: navigation, categories, feature flags. */
  STABLE: 15 * 60_000,
  /** Typical reads: lists, detail pages. */
  MODERATE: 5 * 60_000,
  /** Volatile but cacheable briefly: search results, the current user. */
  FRESH: 60_000,
  /** Always refetch: cart totals, anything price/availability-sensitive. */
  REALTIME: 0,
} as const;

/** Garbage-collection windows (TanStack `gcTime`) — how long unused data lingers. */
export const GC = {
  LONG: 60 * 60_000,
  MEDIUM: 10 * 60_000,
  SHORT: 5 * 60_000,
} as const;

/**
 * Auth token lifetimes (ADR 0016). Platform-neutral so `@repo/auth` (middleware,
 * SessionMonitor) and the web MSW mock derive the same numbers. `ACCESS_TOKEN_TTL_MS`
 * is the assumed access-token lifetime when the JWT carries no `exp`;
 * `REFRESH_PROACTIVE_BUFFER_MS` is how early SessionMonitor refreshes before
 * expiry; `SESSION_MONITOR_INTERVAL_MS` is its poll cadence.
 */
export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;

export const REFRESH_PROACTIVE_BUFFER_MS = 2 * 60_000;

export const SESSION_MONITOR_INTERVAL_MS = 60_000;

/**
 * Auth cookie names (ADR 0016 follow-up). Platform-neutral so the web cookie
 * adapter, the Next middleware gate, and the RSC server client all agree.
 * `ACCESS_TOKEN_COOKIE` holds the short-lived access token (written by client JS
 * so the Next server can read it for middleware/RSC — see apps/web). The
 * long-lived refresh token stays in its httpOnly cookie named below, set by the
 * backend; the client only ever checks its presence, never its value.
 */
export const ACCESS_TOKEN_COOKIE = "access_token";

export const REFRESH_TOKEN_COOKIE = "refresh_token";
