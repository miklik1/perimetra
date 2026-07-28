"use client";

import * as React from "react";
import { useStore } from "zustand";

import { useTranslations } from "@repo/i18n/web";
import { type ThemePreference } from "@repo/store";
import { SegmentedNav, SegmentedNavItem } from "@repo/ui";

import { themeStore } from "../../lib/theme";

/**
 * The theme override (ADR 0140) — the control that was missing, not the machine.
 *
 * Everything underneath already existed: `themeStore` models `light | dark |
 * system` and persists to `localStorage["theme"]` synchronously, `ThemeEffect`
 * applies the preference and re-resolves on OS flip, and the no-FOUC script in
 * the root layout reads the same key before first paint. Until this component
 * there was simply no way for a user to call `setTheme`, so the preference was
 * pinned to whatever the OS said. Mobile has shipped a toggle since ADR 0010.
 *
 * `setTheme`, never `toggle()` — the store's two-way `toggle` flips light↔dark
 * and can never produce `system`, which is the default and the only mode that
 * follows the OS.
 */

/** Ordered so the explicit choices lead and `system` reads as "hand it back". */
const OPTIONS: readonly ThemePreference[] = ["light", "dark", "system"];

const ICONS: Record<ThemePreference, React.ReactNode> = {
  light: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ),
  dark: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" />
    </svg>
  ),
  system: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
};

export function ThemeToggle({ labelledBy }: { labelledBy: string }) {
  const t = useTranslations("theme");
  const theme = useStore(themeStore, (s) => s.theme);
  const setTheme = useStore(themeStore, (s) => s.setTheme);

  // The store's storage adapter is SSR-guarded and returns the `system` default
  // on the server, so a user whose stored preference is `dark` would have the
  // server mark `system` pressed and the client mark `dark` — a hydration
  // mismatch on every authenticated page load. Gating on a mount flag keeps the
  // FIRST client render byte-identical to the server's (both see `mounted =
  // false`); the effect then flips it and React re-renders with the real value.
  // This costs nothing visually: the no-FOUC script has already applied the
  // theme itself, so only which pill reads as pressed settles a tick late.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <SegmentedNav
      aria-labelledby={labelledBy}
      value={mounted ? theme : "system"}
      onValueChange={(next) => setTheme(next as ThemePreference)}
    >
      {OPTIONS.map((option) => (
        <SegmentedNavItem key={option} value={option} icon={ICONS[option]} label={t(option)} />
      ))}
    </SegmentedNav>
  );
}
