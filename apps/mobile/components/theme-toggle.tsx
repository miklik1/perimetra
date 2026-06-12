import { useStore } from "zustand";

import { type ThemePreference } from "@repo/store";

import { themeStore } from "../lib/theme";
import { Button } from "./ui";

const ORDER: readonly ThemePreference[] = ["light", "dark", "system"];

/** Cycles the theme preference light → dark → system (ADR 0010). */
export function ThemeToggle() {
  const theme = useStore(themeStore, (s) => s.theme);
  const setTheme = useStore(themeStore, (s) => s.setTheme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;

  return <Button label={`Theme: ${theme}`} variant="secondary" onPress={() => setTheme(next)} />;
}
