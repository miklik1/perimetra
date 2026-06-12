import { LOCALE_COOKIE, type Locale } from "@repo/i18n";

// Locale persistence as a JS-readable cookie (ADR 0020). A browser adapter that
// lives in the app, like auth-token-cookie — @repo/i18n stays free of DOM
// globals. The cookie is the single source the Next server reads in
// `i18n/request.ts` to render RSC in the right locale; the client only ever
// WRITES it (then `router.refresh()`), and reads the active locale back through
// next-intl's `useLocale()` — so there is no client-side cookie read to keep in
// sync. `document`-guarded so it no-ops under SSR. Not sensitive (a UI
// preference), so plain `SameSite=Lax`; `Secure` except local dev (no TLS).

// One year — a locale preference is durable, unlike the short-lived access token.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const secureAttr = process.env.NODE_ENV === "production" ? "; Secure" : "";

export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secureAttr}`;
}
