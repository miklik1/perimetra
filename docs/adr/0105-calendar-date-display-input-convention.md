# ADR 0105 — Calendar-date convention: UTC-force the display, local-default the input

**Status:** Accepted (2026-07-08). Implemented. Extends ADR 0023 (Intl-based
date/time formatting; no date-math lib).

> Drained from **skeleton ADR 0047** (channel A, `1185fe7`) and renumbered —
> perimetra's 0047 is the engine error taxonomy. Future upstream commits citing
> "ADR 0047" in date-formatting code refer to THIS decision.

## Context

`@repo/utils/format` shipped `formatDate` (Intl in the viewer's ambient zone)
and `toIsoDate` (`toISOString`, i.e. UTC) — both correct for a true **instant**
(a timestamp that carries a real time-of-day). But a large class of values are
**calendar dates**: a wall-clock day with no time-of-day meaning (a birthday, an
invoice or booking day, anything stored as `YYYY-MM-DD`). Formatting those with
the instant helpers produces off-by-one-day bugs at the timezone seam:

- **Display.** JS parses a `YYYY-MM-DD` string as UTC midnight. `formatDate`
  renders it in the viewer's ambient zone, so a viewer west of UTC sees the
  **previous** day.
- **Input.** `toIsoDate(new Date())` returns the UTC date. Just after local
  midnight in a positive-offset zone (cs/CET is the default market), that is
  **yesterday** — the wrong default for an `<input type="date">`.

This is a recurring cross-project bug class (vault finding "Calendar-date
strings — UTC-force the display, local-default the input", 2026-06-19).

## Decision

Add two calendar-date helpers to `@repo/utils/format` and a usage rule.

- `formatCalendarDate(value, options?, locale?)` — pins `Intl.DateTimeFormat` to
  `timeZone: "UTC"`, so a date-only value renders as that **same calendar day**
  in every viewer's zone.
- `toLocalIsoDate(value = new Date())` — builds `YYYY-MM-DD` from **local** clock
  parts (`getFullYear`/`getMonth`/`getDate`), never `toISOString`, so a date
  default is the user's today.

Rule: **date-only values use the calendar helpers; true instants keep
`formatDate` / `toIsoDate`.** `toIsoDate` is unchanged — it remains correct for a
timestamp's UTC date. No date-math library is added (ADR 0023 stands; Temporal
still deferred behind its seam).

## Consequences

- Two new exports from `@repo/utils/format`; the JSDoc on each names which to
  reach for so a consumer can't pick the wrong one silently.
- Tests are deterministic and TZ-independent: `formatCalendarDate` is proven to
  hold the UTC day against an explicit western zone (`America/New_York`);
  `toLocalIsoDate` is proven to build from local parts. (The runner is TZ=UTC.)
- Consumers with off-by-one date bugs migrate call sites; nothing is forced —
  the instant helpers still exist for instant values.

## Sources

- Vault finding "Calendar-date strings — UTC-force the display, local-default
  the input" (2026-06-19).
- Extends ADR 0023 (date/time: Intl-based formatting, Temporal deferred).
