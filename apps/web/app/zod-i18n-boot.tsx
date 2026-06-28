"use client";

import { useEffect } from "react";

import { installZodErrorMap, type Translator } from "@repo/i18n";
import { useTranslations } from "@repo/i18n/web";

/**
 * Installs the zod error-map at boot (`z.config`, ADR 0020) so every
 * `@repo/validators` schema renders its generic-code messages (invalid type /
 * too small / too big / format) through the active catalog instead of zod's
 * built-in English. The map is built+tested in `@repo/i18n` but is inert until
 * wired here once on the client.
 *
 * Effect timing is safe: react-hook-form validates on user interaction (submit/
 * blur/change), which can only happen after hydration — long after this mount
 * effect has run. Re-keys on `t` so a client-side locale switch re-wires.
 */
export function ZodI18nBoot(): null {
  const t = useTranslations();
  useEffect(() => {
    installZodErrorMap(t as unknown as Translator);
  }, [t]);
  return null;
}
