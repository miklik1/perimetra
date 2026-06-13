/**
 * Money display formatter (I10). The value of record is always the decimal
 * STRING the engine emits; this only renders it for display through `Intl`.
 * Never do arithmetic on the string and never round-trip a raw float through
 * here — pass the engine's `MoneyString`. Shared by every result surface so a
 * currency/precision change lands in exactly one place.
 */
export function formatMoney(decimal: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CZK",
    maximumFractionDigits: 3,
  }).format(Number(decimal));
}
