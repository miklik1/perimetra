import { FALLBACK_LOCALE } from "./locale";

/** Format a Date/timestamp via `Intl.DateTimeFormat` (platform-neutral). */
export function formatDate(
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  locale: string = FALLBACK_LOCALE,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** ISO-8601 date-only string (`YYYY-MM-DD`) in UTC. */
export function toIsoDate(value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}
