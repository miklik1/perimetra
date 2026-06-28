import { useEffect } from "react";

import { installZodErrorMap, type Translator } from "@repo/i18n";
import { useTranslations } from "@repo/i18n/native";

/**
 * Installs the zod error-map at boot (`z.config`, ADR 0020) so every
 * `@repo/validators` schema renders its generic-code messages through the
 * active catalog instead of zod's built-in English — the React Native mirror
 * of web's `ZodI18nBoot`. Re-keys on `t` so a locale switch re-wires. Effect
 * timing is safe: forms validate on user interaction, after this mount effect.
 */
export function ZodI18nBoot(): null {
  const t = useTranslations();
  useEffect(() => {
    installZodErrorMap(t as unknown as Translator);
  }, [t]);
  return null;
}
