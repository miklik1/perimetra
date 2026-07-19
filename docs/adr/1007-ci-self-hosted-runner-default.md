# ADR 1007 — CI defaults to a self-hosted runner (hosted is the fallback via `CI_RUNNER`), on the pinned gitleaks CLI

**Status:** Accepted (2026-07-12) — **HQ-ruled default, Martin ratify queued** (do-first doctrine 2026-07-12, ruling #11). Amends [ADR 1003](1003-ci-cadence-fast-gates-push-heavy-scheduled.md) — its **runner** half only; the trigger **cadence** (fast gates every trigger; heavy jobs on PR + weekly + dispatch) is unchanged. Drained from skeleton `8c53693`; adapted to perimetra's trigger set (see below).

## Context

The GitHub account is billing-blocked (payments failed / spending-limit): hosted-runner jobs die in ~2–4 s with a billing message, empirically since ~2026-07-09 (they ran ~10 min before the block), and even a `workflow_dispatch` dies in ~6 s — so the block gates non-push events too. This is a **portfolio-level** account state, not a perimetra-specific one. ADR 1003 already cut hosted-minute consumption to near-zero by never running on a bare push, but a `ci.yml` change cannot clear a billing block. A **self-hosted** GitHub Actions runner consumes ZERO metered GitHub minutes on any plan, so moving CI onto Martin's own hardware makes both the minute budget and the billing block cease to constrain CI.

The known kill-chain for self-hosted runners is: a `pull_request` workflow from a **fork** checks out and runs the attacker's tree on your machine. GitHub's guidance: never attach self-hosted runners to public repos.

Separately, the same change moves the secret scan off `gitleaks-action@v3`. The action calls the PR API (`ScanPullRequest`) and, under this workflow's new `permissions: contents: read`, 403s on same-repo PRs for lack of the `pull-requests` scope. The pinned MIT CLI binary (8.24.3) needs no `GITHUB_TOKEN` and no org license, works read-only, and is the same binary the local lefthook hook runs — so local and CI agree on the exact scanner. (That binary silently ignores the array-of-tables `[[allowlists]]` config form and fails open; `.gitleaks.toml` is the singular `[allowlist]` table — see the file header and the gitleaks fix commit.)

## Decision

Every job defaults to the self-hosted runner via a repo-variable switch, so the repo flips back to hosted in one setting with no YAML change:

```yaml
runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
```

Set the repo variable `CI_RUNNER=self-hosted` once a runner is registered; unset it to fall back to the free hosted minutes. Layered fork-PR defence, all landed in this change:

1. **Fork-PR fence on every job:** `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository` — a fork-head PR never schedules onto the box. Belt-and-braces even though the repo is private, personal, and zero-collaborator today (so the untrusted-PR surface does not yet exist).
2. **`permissions: contents: read`** at the workflow level — every job here only reads the repo (nothing pushes commits, comments on PRs, or writes releases; deploys build from the provider's own GitHub integration), so all other token scopes default to `none` and a hostile job has no write `GITHUB_TOKEN` to steal.
3. **Pinned gitleaks CLI** (8.24.3) in place of `gitleaks-action@v3`, for the reason above.
4. `pull_request_target` + PR-head checkout stays banned (the classic privilege-escalation combo; no job uses it).

The **machine-level install** — an ephemeral `actions-runner` container (`--ephemeral`, fresh per job) with a `docker:dind` sidecar (not the host socket), ideally via JIT registration (no long-lived admin PAT in job-readable env) — is the HQ-owned companion, tracked in the CI-posture note, not in this repo. Until a runner greens the checks, the ship-bar stays the local cold gate + adversarial review (the interim protocol).

## Perimetra adaptation

The skeleton AND-composes the fork fence with each heavy job's existing `if: github.event_name != 'push'` guard. **Perimetra has no such guards** — it satisfies ADR 1003's cadence by TRIGGER SET (it has never had a `push:` trigger; the heavy surface is off the per-commit path structurally, per the 1003 row), so a bare push starts no job at all. The fork fence therefore lands here as a **standalone** job-level condition on all 11 jobs, not an AND-composition. Everything else is adopted verbatim. Unlike ADR 1003 (a documented _partial_ adoption), perimetra adopts ADR 1007 in full: the runner posture is a portfolio-level unblock, and the YAML is inert until `CI_RUNNER` is set.

## Consequences

- The YAML change is **inert until `CI_RUNNER` is set**: with it unset, `runs-on` resolves to `ubuntu-latest` exactly as before, and the fork fence only ever _skips_ fork PRs (none exist on a private solo repo). So this lands safely ahead of the runner install.
- The pinned gitleaks CLI is the honest scanner: verified locally with 8.24.3 that the singular `[allowlist]` form is honoured (the plural form fails open) and that the full-history `detect --source .` — the exact CI command — reports no leaks, including the allowlisted local-dev centrifugo config.
- Deploys stay on the provider's own GitHub integration (Railway/Vercel) — zero Actions minutes and no deploy secrets on a runner.
- **~~Open verification (CHECK 2026-07-19)~~ — RESOLVED 2026-07-16:** the open question was whether a payment-failed account state _also_ refuses to schedule _self-hosted_ jobs (the `workflow_dispatch` ~6 s deaths suggested it might). It does **not**. A user-space runner registered to `miklik1/fullstack-skeleton` ran the full `workflow_dispatch` matrix and every job scheduled and executed, despite the same account state that kills hosted jobs in 3–6 s. Failures in that run (build, E2E, smoke, trivy) were unrelated real causes — drifted Expo patch versions, a no-root Playwright install, an actual CVE — not scheduling faults. Because this is an account-level property, verifying on the skeleton settles it for perimetra too. Martin's end-state call: `CI_RUNNER` left **unset** and the test runner **deregistered**, since it was ephemeral — leaving `CI_RUNNER=self-hosted` pointed at no runner would hang every future push, which is strictly worse than the billing block's fast-fail. So the inert `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}` default below is the current, deliberate, ratified posture, not drift. A _persistent_ perimetra runner remains a separate forward task, not this check.
- **HQ-ruled default (ratify queued):** the all-in self-hosted posture is HQ's call under the do-first doctrine; Martin's ratification/veto is queued in the Brain hub. Fully reversible (unset `CI_RUNNER`).

## Sources

- Vault: "Infra & CI posture — free GitHub minutes, no subscription (+ CAR-40 host)" (2026-07-12) — the portfolio posture + the security red-team this implements.
- Vault decision: "do-first doctrine & blocker triage (2026-07-12)", ruling #11.
- [ADR 1003](1003-ci-cadence-fast-gates-push-heavy-scheduled.md) — the cadence this amends (runner half only).
- Skeleton `8c53693`; local gitleaks 8.24.3 verification (this drain).
