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
