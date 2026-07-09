import { FALLBACK_LOCALE } from "./locale";

/** Format a Date/timestamp via `Intl.DateTimeFormat` (platform-neutral). */
export function formatDate(
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  locale: string = FALLBACK_LOCALE,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** ISO-8601 date-only string (`YYYY-MM-DD`) in UTC. */
export function toIsoDate(value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * Format a CALENDAR date — a wall-clock day with no time-of-day meaning (a
 * birthday, an invoice date, a booking day stored as `YYYY-MM-DD`) — so it
 * renders as THAT day in every viewer's timezone. `Intl` is pinned to
 * `timeZone: "UTC"`, so a date-only value (which JS parses as UTC midnight) can
 * never slip to the previous day for a viewer west of UTC. Use this for
 * date-only values; use {@link formatDate} for a true instant (a timestamp that
 * carries a real time-of-day). See ADR "calendar-date display/input convention".
 */
export function formatCalendarDate(
  value: Date | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  locale: string = FALLBACK_LOCALE,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
}

/**
 * Today's (or a given Date's) calendar day as `YYYY-MM-DD`, built from the LOCAL
 * clock — the correct default for a date INPUT (`<input type="date">`). Unlike
 * {@link toIsoDate} (which goes through `toISOString`, i.e. UTC), this never
 * rolls the day across midnight for a viewer whose offset differs from UTC: just
 * after local midnight in a positive-offset zone, `toIsoDate(new Date())` still
 * returns *yesterday* in UTC, whereas this returns the local today. Use
 * `toIsoDate` for a true timestamp's UTC date; use this for a user-facing default.
 */
export function toLocalIsoDate(value: Date = new Date()): string {
  if (Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
