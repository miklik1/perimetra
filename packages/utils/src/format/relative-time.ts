import { FALLBACK_LOCALE } from "./locale";

// Unit sizes in seconds, largest first. Month/year use calendar-ish averages
// (30d / 365d) — fine for display copy; date math is out of scope (ADR 0023:
// Intl only, no date library, Temporal deferred).
const UNITS = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
] as const satisfies readonly (readonly [Intl.RelativeTimeFormatUnit, number])[];

// Round half away from zero so past/future are symmetric (Math.round alone
// rounds -0.5 toward zero but +0.5 away — 30s would format differently by
// direction).
function roundAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Format the distance between `value` and `baseDate` (default: now) via
 * `Intl.RelativeTimeFormat` ("před 2 hodinami" / "2 hours ago"), choosing the
 * largest unit whose ROUNDED count is ≥ 1 — so 1.9 days reads "in 2 days",
 * 6.9 days rolls to "next week", and ~24 hours becomes "tomorrow" (never the
 * "in 24 hours" truncation artifact). `numeric: "auto"` yields idioms like
 * "yesterday"/"včera". Hermes-safe (platform-neutral).
 */
export function formatRelativeTime(
  value: Date | number | string,
  baseDate: Date | number | string = Date.now(),
  locale: string = FALLBACK_LOCALE,
): string {
  const target = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const base = baseDate instanceof Date ? baseDate.getTime() : new Date(baseDate).getTime();
  const diffSeconds = (target - base) / 1000;

  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, seconds] of UNITS) {
    const rounded = roundAway(diffSeconds / seconds);
    if (Math.abs(rounded) >= 1) return format.format(rounded, unit);
  }
  return format.format(roundAway(diffSeconds), "second");
}
