import { createStore, type StoreApi } from "zustand/vanilla";

/** User's theme preference. `system` defers to the OS color scheme. */
export type ThemePreference = "light" | "dark" | "system";

/** A concrete, applied color scheme (never `system`). */
export type ColorScheme = "light" | "dark";

/**
 * The preference before any stored value exists. Also the SSR snapshot: the
 * server has no storage, so server-rendered HTML always reflects this value —
 * theme-dependent client UI must hydrate against it (`useSyncExternalStore`
 * server snapshot), then re-render with the persisted preference.
 */
export const DEFAULT_THEME: ThemePreference = "system";

/**
 * Narrow an arbitrary string to a `ThemePreference`. Storage adapters read
 * untrusted values (web `localStorage`, mobile AsyncStorage) that must be
 * validated before they hydrate the store — the one home for that check.
 */
export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Platform-supplied persistence for the preference. Web backs this with
 * `localStorage`; mobile with device storage. Kept synchronous so the store can
 * hydrate its initial value without an async dance — adapters wrapping async
 * storage should seed from an in-memory mirror.
 */
export interface ThemeStorage {
  get: () => ThemePreference | null;
  set: (value: ThemePreference) => void;
}

export interface ThemeState {
  /** The stored preference (light/dark/system). */
  theme: ThemePreference;
  /** Set + persist an explicit preference. */
  setTheme: (theme: ThemePreference) => void;
  /** Flip between light and dark (treats `system` as currently-light). */
  toggle: () => void;
}

/**
 * Resolve a preference against the live OS scheme. Pure — the OS scheme is
 * platform state (web `matchMedia`, mobile `Appearance`) the caller supplies, so
 * resolution stays out of the store (ADR 0010).
 */
export function resolveScheme(theme: ThemePreference, systemScheme: ColorScheme): ColorScheme {
  return theme === "system" ? systemScheme : theme;
}

/**
 * Build a theme store bound to a platform `ThemeStorage`. The preference state
 * machine lives here (one implementation for web + mobile); persistence and the
 * apply-effect are the app's concern. Vanilla store (no React) — consume with
 * `useStore` from `zustand` (ADR 0010).
 */
export function createThemeStore(storage: ThemeStorage): StoreApi<ThemeState> {
  return createStore<ThemeState>((set, get) => ({
    theme: storage.get() ?? DEFAULT_THEME,
    setTheme: (theme) => {
      storage.set(theme);
      set({ theme });
    },
    toggle: () => {
      const next: ThemePreference = get().theme === "dark" ? "light" : "dark";
      storage.set(next);
      set({ theme: next });
    },
  }));
}
