"use client";

import { useRouter } from "next/navigation";

import { LOCALES } from "@repo/i18n";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

import { writeLocaleCookie } from "../lib/locale-cookie";

/**
 * Cycles the active locale (ADR 0020). On web the cookie is the single source of
 * truth: `useLocale()` reads the value next-intl resolved from it server-side
 * (so SSR and client agree — no hydration mismatch), and the click writes the
 * cookie + `router.refresh()` re-runs the RSC render so the whole tree (and this
 * button) re-renders in the new locale. Mirrors `ThemeToggle`'s cycle.
 */
export function LocaleSwitcher() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("locale");
  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]!;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        writeLocaleCookie(next);
        router.refresh();
      }}
    >
      {t("label")}: {t(locale)}
    </Button>
  );
}
