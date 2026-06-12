/**
 * Last-resort fallback locale for the formatters when a caller passes none. This
 * is a defensive default for a pure leaf — NOT the configured app locale, which
 * `@repo/i18n` owns (`DEFAULT_LOCALE`, cs-first). Kept local so `@repo/utils`
 * stays free of a `@repo/i18n`/`@repo/config` dependency (ADR 0020); apps thread
 * the active locale from `@repo/i18n` into each formatter call explicitly.
 */
export const FALLBACK_LOCALE = "en-US";
