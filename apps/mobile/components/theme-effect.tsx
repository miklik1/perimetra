import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Appearance } from "react-native";
import { useStore } from "zustand";

import { hydrateTheme, themeStore } from "../lib/theme";

/**
 * Bootstraps and drives the app color scheme from the theme store (ADR 0010).
 * On mount it seeds the store from device storage (`hydrateTheme`, async — the
 * store starts at "system" and advances once the read resolves). It then drives
 * RN's `Appearance.setColorScheme` — NativeWind v5 observes it under
 * `userInterfaceStyle: "automatic"` (app.config.ts) to flip the `dark` variant,
 * and NativeWind's own `useColorScheme` is deprecated. `system` maps to RN's
 * `"unspecified"` (defer to the OS). Renders nothing; mounted once in the root
 * layout.
 */
export function ThemeEffect() {
  const theme = useStore(themeStore, (s) => s.theme);

  useEffect(() => {
    // Seed the store from disk, then reveal the UI. The splash (held in
    // app/_layout.tsx) hides once hydration settles — whether it restored a saved
    // preference or found none — so the first visible frame is the right scheme.
    void hydrateTheme().finally(() => {
      void SplashScreen.hideAsync();
    });
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(theme === "system" ? "unspecified" : theme);
  }, [theme]);

  return null;
}
