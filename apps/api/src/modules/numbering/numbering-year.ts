/**
 * The number-series YEAR, pinned to the fiscal timezone (Europe/Prague).
 *
 * `NumberingService.allocate()` is keyed on `(org, series, year)` and takes the
 * year from its app-layer caller (the engine never sees a clock — I1
 * determinism). Taking it from `new Date().getFullYear()` reads the SERVER's
 * local clock, which on every container we ship is UTC — and UTC rolls over an
 * hour AFTER Prague does in winter (CET = UTC+1). So for the first hour of the
 * Czech new year — Prague 00:00–01:00 on 1 January, which is 23:00–24:00 UTC on
 * 31 December — a UTC box still reports the OLD year: a quote frozen at 00:30
 * CET on 1 January numbers into the CLOSED `2026` series, while the invoice
 * raised from it numbers into `2027` (its year comes from the DUZP, below).
 * Same deal, two series, two years, in exactly the window an accountant
 * reconciles.
 *
 * Quote and order numbers are OPERATIONAL handles, not statutory ones (ADR
 * 0109), so the defect here is INCONSISTENCY, not illegality — but the remedy is
 * the one the statutory path already took: pin the calendar to Prague, so all
 * three series agree about which year a moment belongs to.
 *
 * The INVOICE path deliberately does NOT use this helper. Its číselná řada year
 * is the DUZP year (`numberingYearFromDuzp` in `@cardo/tax-cz`) — a FACT read off
 * the document, not a wall clock: a December-DUZP invoice issued in January must
 * number in the December year, which no clock helper can express. This is the
 * wall-clock equivalent for the two series that have no DUZP to read.
 *
 * `now` is injectable so the boundary behaviour is unit-testable without
 * faking system time.
 */
export function numberingYear(now: Date = new Date()): number {
  // Ask Intl for the year PART directly rather than slicing a formatted date —
  // the timezone shift is the whole point, and a part is unambiguous.
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric" }).format(now),
  );
}
