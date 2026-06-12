import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  createThemeStore,
  isThemePreference,
  type ThemePreference,
  type ThemeStorage,
} from "@repo/store";

// Mobile persistence for the theme preference (ADR 0010; engine choice ADR 0015 —
// AsyncStorage over MMKV to keep the app Expo Go-compatible). The store's
// `ThemeStorage` seam is synchronous so it can hydrate at construction, but
// AsyncStorage is async — so we bridge with an in-memory mirror: `get`/`set` are
// instant against the mirror, every `set` fires a write-behind to disk, and the
// mirror is seeded from disk once at boot (`hydrateTheme`). The async seam is why
// the splash is held until `hydrateTheme` settles (app/_layout.tsx + ThemeEffect),
// avoiding a cold-start flash. The key + value space match the web adapter
// (apps/web/lib/theme.ts).
const THEME_STORAGE_KEY = "theme";

let mirror: ThemePreference | null = null;
// True once the mirror holds an authoritative preference — either the user set
// one this session or `hydrateTheme` restored a saved one. Guards a late or
// duplicate disk read (cold-start write-vs-read race, StrictMode double-mount)
// from overwriting it.
let settled = false;

const mobileThemeStorage: ThemeStorage = {
  get: () => mirror,
  set: (value) => {
    mirror = value;
    settled = true;
    void AsyncStorage.setItem(THEME_STORAGE_KEY, value);
  },
};

/** Single app-scoped theme store. Consumed via `useStore` (zustand). */
export const themeStore = createThemeStore(mobileThemeStorage);

/**
 * Seed the store from disk. AsyncStorage can't be read synchronously, so the
 * store is constructed at "system" and corrected here once the read resolves.
 * Call once at app start (mounted via `ThemeEffect`); one-shot and a no-op when
 * nothing valid is persisted or the preference is already settled.
 */
export async function hydrateTheme(): Promise<void> {
  const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
  if (settled || !isThemePreference(stored)) return;
  mirror = stored;
  settled = true;
  themeStore.setState({ theme: stored });
}
