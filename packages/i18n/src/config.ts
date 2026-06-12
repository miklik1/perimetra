/**
 * Locale identity — the single authority for which locales exist and the
 * defaults the rest of the system derives from (ADR 0020). Pure data + a type
 * guard: no React, no next-intl/use-intl, so it is safe to import from any
 * bundle (RSC, client, RN, Node tests). `@repo/config` deliberately dropped its
 * dead `DEFAULT_LOCALE`/`DEFAULT_CURRENCY`; this is their live home.
 */

/**
 * Supported locales, `cs`-first. `cs` is the runtime fallback and the `Messages`
 * type source-of-truth (the first product is Czech and may never render `en`);
 * `en` is kept a complete, first-class locale — guarded by the catalog-parity
 * test — so the skeleton stays "ready for `en`" behind a one-line default switch.
 */
export const LOCALES = ["cs", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** Runtime fallback locale (cs-first, ADR 0020). */
export const DEFAULT_LOCALE: Locale = "cs";

/**
 * Narrow untrusted input (cookie value, device locale, stored override) to a
 * `Locale` before it selects a catalog. Same role as `isThemePreference` in
 * `@repo/store` — the one home for that check.
 */
export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && (LOCALES as readonly string[]).includes(value);
}

/**
 * The cookie the web server, client, and switcher all agree on. Owned here (not
 * in `@repo/config` alongside `ACCESS_TOKEN_COOKIE`) because it is single-domain
 * — only `@repo/i18n` and the web app touch it (ADR 0010/0020 identity-constant
 * rule).
 */
export const LOCALE_COOKIE = "locale";

/**
 * Default currency for `formatCurrency`, aligned with the cs-first default:
 * `formatCurrency(v, DEFAULT_CURRENCY, "cs")` → `"1 234,50 Kč"`. Re-homed here
 * from the dead `@repo/config` copy.
 */
export const DEFAULT_CURRENCY = "CZK";

/**
 * Fallback time zone for the mobile `IntlProvider` (use-intl warns when none is
 * supplied for date/time formatting). Czech-product default; a real app reads
 * the device zone and passes it in.
 */
export const DEFAULT_TIME_ZONE = "Europe/Prague";
