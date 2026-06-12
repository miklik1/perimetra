import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";

import {
  createLocaleStore,
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type LocaleStorage,
} from "@repo/i18n";

// Mobile persistence for the active locale (ADR 0020). Same in-memory-mirror +
// write-behind + boot-hydrate bridge as the theme store (lib/theme.ts): the
// `LocaleStorage` seam is synchronous so the store hydrates at construction, but
// AsyncStorage is async, so `get`/`set` hit the mirror instantly and every `set`
// fires a write-behind to disk. `hydrateLocale` seeds the mirror once at boot.
const LOCALE_STORAGE_KEY = "locale";

let mirror: Locale | null = null;
// True once the mirror holds an authoritative locale — a user choice this session
// or one restored by `hydrateLocale`. Guards a late/duplicate disk read from
// overwriting it (cold-start race, StrictMode double-mount).
let settled = false;

const mobileLocaleStorage: LocaleStorage = {
  get: () => mirror,
  set: (value) => {
    mirror = value;
    settled = true;
    void AsyncStorage.setItem(LOCALE_STORAGE_KEY, value);
  },
};

/** Single app-scoped locale store. Consumed via `useStore` (zustand). */
export const localeStore = createLocaleStore(mobileLocaleStorage);

/**
 * Seed the store from disk, then the device. Resolution order: a persisted user
 * override → else the device locale (`expo-localization`, narrowed) → else
 * `DEFAULT_LOCALE` (the store's construction value). Only user choices are
 * written to disk; a device-derived locale stays in-memory. Call once at app
 * start (mounted via `LocaleEffect`); one-shot and a no-op once settled.
 */
export async function hydrateLocale(): Promise<void> {
  if (settled) return;
  const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
  if (settled) return;

  if (isLocale(stored)) {
    mirror = stored;
    settled = true;
    localeStore.setState({ locale: stored });
    return;
  }

  const device = getLocales()[0]?.languageCode;
  const resolved: Locale = isLocale(device) ? device : DEFAULT_LOCALE;
  mirror = resolved;
  settled = true;
  localeStore.setState({ locale: resolved });
}
