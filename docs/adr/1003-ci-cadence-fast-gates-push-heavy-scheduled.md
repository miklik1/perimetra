# ADR 1003 — CI cadence: fast gates on every push, heavy jobs on PR + weekly + dispatch

**Status:** Accepted (2026-07-10).

## Context

This repo is **private**, so GitHub Actions minutes are metered against the account's plan. The CI workflow ran its **full 11-job matrix on every push to `main` and every PR** — including the expensive jobs: the Docker api-image build (~6 min), Trivy image scan, Testcontainers integration suite, the Playwright web-E2E and a full real-stack smoke-E2E (compose up + build + migrate + api/worker + Playwright), the mobile/Expo build, and a `pnpm audit --prod` that consistently took **~7–10 minutes** (full advisory resolution over the production dependency tree — reproduced locally, so it is not CI-network-specific).

That is roughly **35 billed minutes per push**. The workflow is authored in a solo-founder repo where commits go straight to `main` (no PR step in practice), so every commit — including docs-only commits — paid the full 35 minutes. The account's Actions **spending limit was exhausted**, after which GitHub refused to start any job: every recent push "failed" in ~4 seconds with a billing message, not a code failure.

The local pre-push hook already runs `lint`, `check-types`, and `test`, so CI re-running those on every push is largely redundant. CI's unique, non-local value is the heavy validation (secret scan, image build + scan, integration, E2E) — exactly the part that is expensive to run every commit.

## Decision

Split CI by trigger rather than running everything on every event.

- **The fast gates run on every trigger** (push, PR, schedule, dispatch): `lint` & `type-check`, `test` (unit + component), `knip`, and `gitleaks` — and on a bare push to `main` they are the **only** jobs that run. These are turbo-cached and short (~6 min total, much of it runner setup). `gitleaks` stays on every push deliberately — a secret scan is cheap, safety-critical, and not reliably run locally (the CLI is often absent from the pre-commit hook).
- **The heavy jobs** — `build` (incl. the Expo SDK-alignment check), `docker-build`, `trivy`, `integration`, `e2e-web`, `smoke-e2e`, and `audit` — carry `if: ${{ github.event_name != 'push' }}`, so they run on **PRs, a weekly schedule** (`cron: "0 4 * * 1"`, Mondays 04:00 UTC), **and manual `workflow_dispatch`** — never on a bare push to `main`.
- `audit` additionally gets `timeout-minutes: 12` so a slow/stalled registry query can't run the clock out. Renovate already watches advisories continuously, so a per-commit audit added ~10 minutes for little marginal signal; weekly + on-demand is the right cadence for it.

## Consequences

- Per-push cost drops from ~35 to ~6 billed minutes (≈80% reduction). Steady-state consumption should fall back within the plan's included allotment.
- The tradeoff: heavy regressions (a broken Docker build, an E2E failure, a new prod CVE, Expo drift) are now caught **on a PR, within a week, or on manual dispatch** — not on the commit that introduced them. This is acceptable for a template repo whose heavy surface changes rarely; before a change that touches that surface, open a PR or run `workflow_dispatch` to validate.
- **This does not itself clear the spending-limit block** — that is an account billing setting. The trim is what keeps consumption under the limit going forward; the block clears when the limit is raised/payment is fixed, or when the next billing cycle starts with consumption reduced.
- **Fleet:** derived repos inherit this cadence when they next merge the skeleton (channel-A). A derived repo that relies on per-commit heavy validation can pull a job back to per-push by removing its `if:`.
- **Real failures surfaced but not fixed here** (they need a billing-unblocked run to iterate, or are deliberately out of scope): the `build` job is red because 7 Expo packages have drifted below their SDK-56 expected versions — a deliberate, SDK-gated `expo install --fix` (ADR 0013 keeps Expo/React bumps manual), owned by the mobile surface; and the `trivy` job flags a fixable HIGH/CRITICAL image CVE. Both now run on the heavy cadence where they can be addressed.

## Sources

- `.github/workflows/ci.yml` (the workflow this ADR restructures).
- ADR 0044 (security baseline — gitleaks/audit/Trivy gates) and ADR 0048 (pre-push test gate; `build` stays a CI concern) — the gates this ADR re-cadences without removing.
- ADR 0013 (Expo/React version bumps are deliberate, SDK-gated) — why the Expo drift is a manual fix, not a Renovate auto-bump.
