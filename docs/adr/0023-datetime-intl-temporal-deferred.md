# ADR 0023 — Date/time strategy: Intl-based formatting now; no date-math library; Temporal deferred

**Status:** Accepted (2026-06-04). Refines the `@repo/utils` formatting surface
([ADR 0008](0008-shared-package-boundaries.md)).

## Context

`@repo/utils/format` formats dates via `Intl.DateTimeFormat` (`formatDate`,
`toIsoDate`). The Tier-B sweep adds relative-time, file-size, and list
formatters. This raised the question of whether to adopt the **TC39 Temporal**
API (or a date library) for richer date handling.

Facts as of 2026-06-04:

- **Temporal** is TC39 Stage 3 and has begun shipping in some browser engines,
  but is **not available in Hermes** (the React Native engine) and is not
  universally present on the web. Cross-platform use requires
  `@js-temporal/polyfill`, which is heavy.
- The skeleton only **formats** dates; it does no date **math** (add/diff/
  timezone arithmetic). Formatting is fully served by `Intl.*`, which works
  everywhere including Hermes.

## Decision

- **Keep all date/time formatting on `Intl`** (`Intl.DateTimeFormat`,
  `Intl.RelativeTimeFormat`, `Intl.NumberFormat`, `Intl.ListFormat`), locale
  passed explicitly per call (ADR 0020 locale ownership). `Intl.DurationFormat`
  is **not** used (absent from Hermes); a duration formatter, if needed, is
  hand-rolled.
- **Add no date-math library** (no date-fns / dayjs / luxon / Temporal polyfill)
  to the skeleton — YAGNI. Nothing in the base needs date arithmetic.
- **Keep the date utilities library-agnostic** so a future choice is a drop-in:
  formatters accept `Date | number | string` and return strings; no date-library
  type leaks into any signature.
- **When date math is first needed**, decide then behind that seam — preferring
  **Temporal via polyfill** once Hermes support lands, or a tree-shakeable,
  immutable library (date-fns) in the interim. Record that as a follow-up ADR.

## Consequences

- Zero date-library weight in the base; formatting works identically on web +
  Hermes today.
- The lib-agnostic signatures mean adopting Temporal (or date-fns) later does not
  ripple through call sites — only the utility internals change.
- A genuine future need (scheduling, timezone math) is an explicit, deferred
  decision rather than a premature dependency now.

## Sources

- TC39 Temporal proposal status (Stage 3; engine availability):
  <https://tc39.es/proposal-temporal/> (verified 2026-06-04).
- Hermes engine (no Temporal): <https://github.com/facebook/hermes> (verified 2026-06-04).
- `Intl.RelativeTimeFormat` / `Intl.ListFormat` support (web + Hermes):
  MDN (verified 2026-06-04).
- [ADR 0020](0020-i18n-next-intl-use-intl.md) (locale passed explicitly to
  formatters).
