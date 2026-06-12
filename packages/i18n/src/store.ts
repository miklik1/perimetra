import { createStore, type StoreApi } from "zustand/vanilla";

import { DEFAULT_LOCALE, type Locale } from "./config";

/**
 * Platform-supplied persistence for the active locale. Web backs this with the
 * `LOCALE_COOKIE` (so the Next server reads the same value); mobile with device
 * storage. Kept synchronous so the store can hydrate its initial value without
 * an async dance — adapters wrapping async storage seed from an in-memory mirror
 * (the theme-store pattern, ADR 0010/0015). Mirrors `ThemeStorage` in
 * `@repo/store`.
 */
export interface LocaleStorage {
  get: () => Locale | null;
  set: (value: Locale) => void;
}

export interface LocaleState {
  /** The active locale. */
  locale: Locale;
  /** Set + persist the active locale. */
  setLocale: (locale: Locale) => void;
}

/**
 * Build a locale store bound to a platform `LocaleStorage`. The locale lives
 * with its domain (this package) the way the auth store lives with `@repo/auth`,
 * rather than in `@repo/store` (ADR 0010 store-placement rule). Vanilla store
 * (no React) — consume with `useStore` from `zustand`. Mirrors `createThemeStore`.
 */
export function createLocaleStore(storage: LocaleStorage): StoreApi<LocaleState> {
  return createStore<LocaleState>((set) => ({
    locale: storage.get() ?? DEFAULT_LOCALE,
    setLocale: (locale) => {
      storage.set(locale);
      set({ locale });
    },
  }));
}
