"use client";

import { useEffect } from "react";
import { useStore } from "zustand";

import { resolveScheme } from "@repo/store";

import { themeStore } from "../lib/theme";

/**
 * Applies the resolved color scheme to `<html>` (toggles `.dark`, the
 * `@custom-variant dark` seam in globals.css). Re-resolves whenever the
 * preference changes or — when preference is `system` — when the OS scheme
 * flips. Renders nothing; mounted once in Providers.
 */
export function ThemeEffect() {
  const theme = useStore(themeStore, (s) => s.theme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const scheme = resolveScheme(theme, media.matches ? "dark" : "light");
      document.documentElement.classList.toggle("dark", scheme === "dark");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return null;
}
