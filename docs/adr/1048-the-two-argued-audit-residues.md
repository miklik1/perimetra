# ADR 1048 — The two argued audit residues, both written down (and one upgrade attempted, measured, reverted)

- **Status:** accepted
- **Date:** 2026-07-28
- **Relates to:** [ADR 1040](1040-the-blind-tree-nineteen-advisories-and-no-gate.md) (the override
  block this extends), [ADR 1041](1041-postcss-and-sharp-need-a-build-not-an-advisory-report.md)
  (the non-audit-verifiable pair), [ADR 0044](0044-security-baseline-supply-chain.md)
  (security baseline), `web-native-skeleton` ADR 0031 (the allowlist SHAPE this
  borrows) and its ADR 1033 (the same brace-expansion argument, measured there)

## Context

The W15 supply-chain pass took `pnpm audit --prod --audit-level high` in this
repo from **19 high advisories to 2**, and stopped there on purpose: the refusal
to allow-list a way to a green line was correct. But two argued residues left in
a transcript are, a month later, indistinguishable from two residues nobody
noticed. The loop had to be closed either by upgrading them or by writing the
argument somewhere the next red will be read.

Re-measured cold at the start of this wave, both were still live:

| Advisory            | Package                            | Range     | Patched   |
| ------------------- | ---------------------------------- | --------- | --------- |
| GHSA-45rx-2jwx-cxfr | `@opentelemetry/propagator-jaeger` | `<2.9.0`  | `>=2.9.0` |
| GHSA-mh99-v99m-4gvg | `brace-expansion`                  | `<=5.0.7` | `>=5.0.8` |

They looked like different kinds of problem — one with a patch available, one without —
and the wave was scoped on the assumption that the first would simply be upgraded. Measuring it
showed otherwise, and the ADR now records the measurement rather than the assumption.

## Decision

**1. `@opentelemetry/propagator-jaeger` stays where it is — the upgrade was tried, measured, and
reverted.** A patch exists (2.10.0), so accepting it needed a stronger argument than "no fix
available", and the first attempt at this ADR asserted the wrong one: that minor skew inside the
stable 2.x line is covered by OpenTelemetry's semver guarantee. It is not, for this package.
`propagator-jaeger@2.10.0` declares `"@opentelemetry/core": "2.10.0"` **exactly**, not a caret. So
forcing it via an override installs a SECOND OTel core beside the 2.7.1 that
`@opentelemetry/sdk-node@0.218.0` and the rest of the catalog resolve — verified in the installed
tree: `@opentelemetry+core@2.7.1` and `@opentelemetry+core@2.10.0` both present, with
propagator-jaeger symlinked to the latter.

Two cores means two copies of the context-propagation machinery and of the global registration
state. That is a silent correctness hazard, and a worse trade than the DoS it would fix. The
override is reverted; the audit count returns to 2 high.

This CONFIRMS the W15 judgement rather than overturning it — W15 declined the same override for the
same reason, and this wave re-measured it rather than taking it on trust. Recording that here
because the reverse mistake is the expensive one: a later reader who finds only "propagator-jaeger
is not overridden" will otherwise assume nobody looked.

Reach, which is what makes acceptance defensible: `JaegerPropagator` is instantiated ONLY when
`OTEL_PROPAGATORS` names `jaeger` (sdk-node's propagator factory map, `build/src/utils.js`). This
tree never sets it, so the default `tracecontext,baggage` applies and the vulnerable class is never
constructed. A derived project that DOES set `OTEL_PROPAGATORS=jaeger` must not wait for the expiry.

The real fix, named in the allowlist entry as the recheck: move the whole `0.218.0` otel catalog set
(sdk-node, both exporters, instrumentation, instrumentation-pg/ioredis/pino) to a line whose
sdk-node itself pins core >= 2.9.0. One core, no override — a versioned-set dependency bump rather
than a one-line lever, and out of scope for a wave whose brief was to close the loop on the residues
rather than to move the observability stack.

**2. `brace-expansion` is ACCEPTED too, in writing, with a date and an expiry.** This
one has no fix on the line that is installed at all. The full argument now lives in
`.audit-allowlist.json` rather than here, because that is the file somebody will
be looking at when the gate eventually exists; in summary:

- the flagged version is `1.1.16`, the newest v1 release. The advisory range is
  `<=5.0.7` and the only patch is `>=5.0.8`, so there is no v1 fix and "upgrade"
  means a forced major;
- that major is API-INCOMPATIBLE with the only consumer here, **measured in this
  tree**: `brace-expansion@5.0.8`'s CommonJS build exports a NAMED `expand`
  (`typeof require("brace-expansion") === "object"`, `.expand` is the function),
  while `minimatch@3.1.5` does `var expand = require("brace-expansion")` and
  calls it directly — which throws `TypeError: expand is not a function`. An
  override would trade a build-tooling DoS for a broken test toolchain;
- reach is `apps/mobile > expo > @expo/cli > react-native > jest-preset >
babel-jest > babel-plugin-istanbul > test-exclude > (glob >) minimatch`, i.e.
  Jest coverage-instrumentation glob matching at TEST time over brace patterns
  this repo authors. Not a runtime path, not attacker-controlled input;
- `brace-expansion@1: ^1.1.16` and `brace-expansion@5: ^5.0.8` stay regardless —
  they clear GHSA-3jxr-9vmj-r5cp and fix the v5 line in place.

Expiry **2026-10-28**, with the recheck named in the entry (has the expo/jest
chain moved off minimatch@3, or has brace-expansion backported a v1 patch). It is
the same residue, the same argument and the same expiry as web-native-skeleton
ADR 1033 — the two trees share the expo/jest chain, so they will clear together
or not at all.

**3. `.audit-allowlist.json` here is a REVIEW RECORD, and says so in its own
first field.** This repo has no `scripts/audit-gate.mjs` and does not get one:
porting it is new drain ceremony/tooling, forbidden by the second half of
Martin's 2026-07-14 "drains narrow to security/correctness" ruling, and the
two-skeletons-two-mechanisms asymmetry sits on the idea/debt stack, not in this
wave's order. So the file has no reader, and a file with no reader that LOOKS
like a gate is worse than no file — it reads as a green line that nothing
computed. The `_note` field states plainly that nothing enforces it, why the port
is unboarded, and how to verify by hand. When the gate is eventually ported, it
inherits a populated, dated allowlist instead of starting blind.

## Consequences

- `pnpm audit --prod --audit-level high` reports **2 high**, unchanged from where
  W15 left it — and both are now written down with a reason and an expiry. The
  line is not green and this ADR does not claim it is. What changed is that the
  argument no longer lives only in a transcript.
- The otel catalog bump is the named next step for the jaeger residue, and it is
  a versioned-set move rather than an override. A project that sets
  `OTEL_PROPAGATORS=jaeger` should do it immediately rather than at expiry.
- Both allowlist entries expire 2026-10-28. Nothing in this repo will re-raise
  them automatically — that is the cost of not having the gate, and it is stated
  here so the cost is a known one rather than a surprise.

## Sources

- `.audit-allowlist.json` (the two dated entries and the `_note`)
- Measured 2026-07-28 in this tree: `pnpm audit --prod --audit-level high`
  (2 high, unchanged); `@opentelemetry/propagator-jaeger@2.10.0`'s exact
  `"@opentelemetry/core": "2.10.0"` dependency and the resulting two-core install
  (`ls node_modules/.pnpm/@opentelemetry+core@*` plus the propagator's own
  `node_modules/@opentelemetry/core` symlink); sdk-node's propagator factory map
  in `build/src/utils.js`; and the brace-expansion v1/v5 CJS export shapes via
  `node -e "typeof require(…)"`
- <https://github.com/advisories/GHSA-45rx-2jwx-cxfr>,
  <https://github.com/advisories/GHSA-mh99-v99m-4gvg>
