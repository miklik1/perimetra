import { useEffect } from "react";

import { hydrateLocale } from "../lib/locale";

/**
 * Seeds the locale store from disk/device once at app start (ADR 0020). Mirrors
 * `ThemeEffect`'s hydrate-on-mount, but does NOT gate the splash: an unresolved
 * locale renders `DEFAULT_LOCALE` (cs), which is correct for the cs-first product
 * — there is no wrong-locale "flash" worth holding the splash for. Renders
 * nothing; mounted once in the root layout.
 */
export function LocaleEffect() {
  useEffect(() => {
    void hydrateLocale();
  }, []);

  return null;
}
