import { FALLBACK_LOCALE } from "./locale";

/** Format an amount as currency via `Intl.NumberFormat` (platform-neutral). */
export function formatCurrency(
  value: number,
  currency: string,
  locale: string = FALLBACK_LOCALE,
  options: Intl.NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(locale, { style: "currency", currency, ...options }).format(value);
}
