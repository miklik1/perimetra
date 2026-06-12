import { createThemeStore, isThemePreference, type ThemeStorage } from "@repo/store";

// Web persistence for the theme preference (ADR 0010). localStorage, guarded for
// SSR. The key + values match the inline no-FOUC script in app/layout.tsx, which
// sets `.dark` before first paint from the same stored value.
const THEME_STORAGE_KEY = "theme";

const webThemeStorage: ThemeStorage = {
  get: () => {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : null;
  },
  set: (value) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  },
};

/** Single browser-scoped theme store. Consumed via `useStore` (zustand). */
export const themeStore = createThemeStore(webThemeStorage);
