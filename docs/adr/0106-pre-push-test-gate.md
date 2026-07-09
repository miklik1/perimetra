# ADR 0106 — Pre-push runs the test gate (not just lint + typecheck)

**Status:** Accepted (2026-07-08). Implemented.

> Drained from **skeleton ADR 0048** (channel A, `1185fe7`) and renumbered —
> perimetra's 0048 is the cascade/overrides ledger. Future upstream commits
> citing "ADR 0048" in git-hook config refer to THIS decision.

## Context

CI fires on `pull_request` (any target branch) and `push` to `main`. A project
stamped from this skeleton commonly adopts a deploy branch (e.g. `stage`) that
auto-deploys on push. A **direct** push to such a branch — not through a PR —
triggers no CI: the `test` and `build` gates then run by **nothing** automatic.

The lefthook pre-push hook was the intended local CI-parity net, but ran only
`lint` + `check-types` — while its own comment claimed it "catches anything that
would fail CI", overstating by two gates. Result: a red unit test can accumulate
silently on a deploy branch. Concrete instance downstream (Primat Plus): a
schema change reddened a fixture round-trip; the test was red on `stage` for a
day, caught only when an unrelated build ran the full suite (vault finding
"direct-to-stage pushes skip CI…", 2026-07-02).

## Decision

Add `test` (`pnpm turbo run test`) to the lefthook **pre-push** jobs, so the
local gate matches the correctness gates CI runs.

`build` stays **CI-only**: it is the slow gate, a broken build fails the platform
deploy (`next build` / the image build) anyway, and adding it to every push
would nudge developers to `--no-verify` — defeating the hook. The hook remains
best-effort (bypassable by `LEFTHOOK=0` / `--no-verify`, by design); the
unbypassable, server-side complement is **branch protection** or a stage-push CI
trigger — both per-project deployment decisions, not skeleton defaults (they
depend on the project's branch model and hosting).

## Consequences

- Every push runs `turbo run test` — turbo-cached, so a no-op when nothing
  changed; a real cost only when code changed, which is exactly when you want it.
- The pre-push philosophy comment, `CONTRIBUTING.md`, and (web-native) `AGENTS.md`
  are corrected to name `test` and to stop overstating coverage.
- Derived projects inherit the fuller local gate; a project that additionally
  wires a stage-push CI trigger or branch protection closes the residual
  `--no-verify` gap.

## Sources

- Vault finding "Direct-to-stage pushes skip CI + pre-push skips test/build → a
  red gate ships unnoticed" (2026-07-02).
