import { FALLBACK_LOCALE } from "./locale";

/** Format a number via `Intl.NumberFormat` (platform-neutral). */
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  locale: string = FALLBACK_LOCALE,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Format a fraction (0–1) as a percentage. */
export function formatPercent(
  value: number,
  options: Intl.NumberFormatOptions = {},
  locale: string = FALLBACK_LOCALE,
): string {
  return new Intl.NumberFormat(locale, { style: "percent", ...options }).format(value);
}
