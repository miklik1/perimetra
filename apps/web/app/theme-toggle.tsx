"use client";

import { useSyncExternalStore } from "react";

import { useTranslations } from "@repo/i18n/web";
import { DEFAULT_THEME, type ThemePreference } from "@repo/store";
import { Button } from "@repo/ui";

import { themeStore } from "../lib/theme";

const ORDER: readonly ThemePreference[] = ["light", "dark", "system"];

/** Cycles the theme preference light → dark → system (ADR 0010). */
export function ThemeToggle() {
  const t = useTranslations("theme");
  // Explicit server snapshot: the client store hydrates from localStorage
  // BEFORE first render, while the server rendered DEFAULT_THEME — a plain
  // store read would mismatch the HTML during hydration. The server snapshot
  // keeps the hydration pass consistent; React re-renders with the persisted
  // preference immediately after. (The page never flashes the wrong THEME —
  // the no-FOUC script in layout.tsx handles that; only this label is late.)
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    () => themeStore.getState().theme,
    () => DEFAULT_THEME,
  );
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;

  return (
    <Button variant="outline" size="sm" onClick={() => themeStore.getState().setTheme(next)}>
      {t("label")}: {t(theme)}
    </Button>
  );
}
