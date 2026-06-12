import { cookies } from "next/headers";

import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { getMessages } from "./messages";
import type { Messages } from "./messages.types";

// Web server (RSC) binding (ADR 0020): the next-intl server API + the request
// config used in "without i18n routing" mode. Re-exports the neutral contract so
// server code has one import surface. Sibling of web.tsx (next-intl splits its
// client/server entry points).
export * from "./index";

export { getLocale, getTranslations, getFormatter, getNow, getTimeZone } from "next-intl/server";

/**
 * The body of the app's `i18n/request.ts`. In "without i18n routing" mode the
 * active locale comes from `LOCALE_COOKIE` during the RSC render pass — no
 * `[locale]` segment, no middleware. Read the cookie, narrow it (unknown/missing
 * → `DEFAULT_LOCALE`), and return the matching catalog. RSC renders already-
 * translated HTML, so there is no untranslated first paint.
 */
export async function buildRequestConfig(): Promise<{
  locale: Locale;
  messages: Messages;
  timeZone: string;
}> {
  const store = await cookies();
  const cookieValue = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
  // A stable timeZone keeps date/number formatting deterministic across the
  // server/client boundary (next-intl warns otherwise — it can cause markup
  // mismatches). Czech-product default; symmetric with the native provider.
  return { locale, messages: getMessages(locale), timeZone: DEFAULT_TIME_ZONE };
}
