# Design — Tier-B polish sweep (validators / utils / navigation)

**Date:** 2026-06-04
**Status:** Implemented — validators primitives (generic + CZ), utils Intl
formatters, navigation typed search params + active-route helpers; shipped
with the `@repo/telemetry` work (the rodné-číslo validator is the scrubber's
obligation source). One refinement over the text below: `stableParams` was
single-homed INTO `@repo/utils` (from `@repo/api`) so `buildPath` reuses it
without a `navigation → api` edge
**Decision records:** [ADR 0022](../../adr/0022-typed-search-params-route-dx.md)
(route DX), [ADR 0023](../../adr/0023-datetime-intl-temporal-deferred.md)
(date/time)

Polish on three existing packages, brainstormed together. Additive schema
primitives and formatters need no ADR; the two real decisions (zod-typed search
params, the date/time strategy) are in ADR 0022 / 0023.

## 1. `@repo/validators` — reusable primitives (incl. CZ)

New `src/primitives/` module, split so a non-CZ project deletes one file:

- `primitives/index.ts` (generic): `password` (length + complexity policy),
  `phoneE164`, `url`, `slug`, `positiveInt`, `money` (non-negative, 2-dp), and
  re-exports of the existing field-level idioms. Message-agnostic — translated
  messages come from the i18n zod error-map (ADR 0020), not hardcoded here.
- `primitives/cz.ts` (Czech, locale-specific): `ico` (8-digit + mod-11
  checksum), `dic` (`CZ` + 8–10 digits), `psc` (`NNN NN` postal code),
  `bankAccount` (prefix-number/bank-code) + `iban` (CZ IBAN), and `rodneCislo`.

**`rodneCislo` is PII** — it validates format + calendar validity + checksum
(no issuance-record/policy checks; the encoded century is unambiguous in both
the 9- and 10-digit forms, so leap years are well-defined) and lives in
`cz.ts` behind an explicit import, with a doc warning. It creates a cross-package
obligation captured in the telemetry spec: **Sentry `beforeSend` must scrub PII**
(rodné číslo, tokens, emails) so a validated-but-rejected value never reaches the
error tracker.

Form-error mapping: keep the framework-agnostic half (`ApiError.fieldErrors()` →
`Record<field,message>`) where it already lives in `@repo/api`; the RHF
`setError` call stays app-level per ADR 0009. No new helper package.

**DAG:** unchanged (`validators → utils`).

## 2. `@repo/utils/format` — more Intl formatters

Add, each taking an explicit `locale` like the existing formatters (ADR 0020
locale ownership; uses the `FALLBACK_LOCALE` default introduced by the i18n work):

- `formatRelativeTime(value, baseDate?, locale?)` — `Intl.RelativeTimeFormat`
  ("před 2 hodinami"); picks the largest sensible unit. Hermes-safe.
- `formatFileSize(bytes, locale?)` — locale-aware decimal ("1,2 MB"), binary or
  decimal base configurable.
- `formatList(items, locale?, type?)` — `Intl.ListFormat` ("a, b a c").

**Not added:** duration (would need `Intl.DurationFormat`, absent from Hermes —
hand-roll only if a concrete need appears) and any date-math library. Date/time
strategy and the Temporal deferral are ADR 0023; formatter signatures stay
library-agnostic (`Date | number | string` in, string out) so a future swap is a
drop-in.

**DAG:** unchanged (`utils` stays a pure leaf).

## 3. `@repo/navigation` — zod-typed search params + active-route helpers

Per ADR 0022:

- Registry entries may declare an optional `search` zod schema; `Href` widens to
  a typed `query` inferred from it.
- `Link` / `useNavigate` accept `query`; `buildPath` serializes it via the
  existing `stableParams` ordering (stable URLs).
- `useSearchParams(route)` — typed read hook wrapping web `useSearchParams` /
  mobile `useLocalSearchParams`; parses through the schema (coercion + defaults);
  invalid params fall back to defaults (never throws — search params are
  user-editable).
- `isActive(href, pathname)` + `useActiveRoute()` — pathname-vs-template matching
  (dynamic segments included) for nav highlighting.

**DAG:** `@repo/navigation` gains a direct `zod` dependency (external — not
governed by boundaries). No new internal edge; explicitly **not**
`navigation → validators` (route contracts vs data contracts — see ADR 0022).

## Whole-graph soundness (the "is the architecture solid" check)

The DAG stays acyclic and single-responsibility after i18n (0020), telemetry
(0021), and this sweep:

```
config   utils   store        ← pure leaves
validators → utils
navigation → utils, config (+ zod ext)        ← route contract incl. search
ui        → utils, config
i18n      → utils, config (owns locale store)
telemetry → utils, config (implements utils' LogSink)
api       → validators, utils, config
api-mocks → validators, config, utils
auth      → api, validators, utils, config (owns auth store)
app       → everything
```

- No cycles: telemetry reaches api logs via the `LogSink` interface defined in
  `utils`, so `api → telemetry` never exists; i18n/telemetry/navigation are
  imported only by apps.
- Each domain owns its own state (auth/locale stores) per the ADR 0010 rule;
  `@repo/store` stays domain-less; `@repo/config` is the only shared-constant
  home (justified by auth↔api-mocks sharing).
- One deliberate responsibility-stretch: `@repo/navigation` gains search-param
  validation — judged cohesive (search params are routing) and the only boundary
  this sweep moves.

## Testing (ADR 0005)

- **validators (Vitest):** each primitive's accept/reject cases; CZ checksums
  (IČO mod-11, rodné číslo) with known-good/bad fixtures.
- **utils (Vitest):** relative-time unit selection, file-size rounding/locale,
  list joining — across `cs` + `en`.
- **navigation (Vitest):** `buildPath` with query serialization (stable order);
  `useSearchParams` coercion + default fallback on garbage input; `isActive`
  with dynamic segments.

## Files (for the plan)

**New:** `packages/validators/src/primitives/{index,cz}.ts` (+ tests);
`packages/utils/src/format/{relative-time,file-size,list}.ts` (+ tests, plus
`format/index.ts` exports); `packages/navigation/src/search.ts` (parse/serialize
and `useSearchParams`) and `active.ts` (`isActive`/`useActiveRoute`) (+ tests).

**Changed:** `packages/validators/src/index.ts` (export primitives);
`packages/navigation/src/{routes,types,index,web,native}.tsx` (search schema in
registry, `Href` widening, query in `Link`/`useNavigate`/`buildPath`),
`packages/navigation/package.json` (+ `zod` dep);
`packages/telemetry` spec (PII `beforeSend` scrubbing — back-propagated);
`docs/adr/0022-*.md`, `0023-*.md`, `docs/adr/README.md`, `ARCHITECTURE.md`.
