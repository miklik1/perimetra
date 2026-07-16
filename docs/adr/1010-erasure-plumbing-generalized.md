# ADR 1010 — Erasure plumbing generalized: a PurgeOutcome read-model and a `finalizeErasure` second-pass seam

**Status:** Accepted (2026-07-16) — **Skeleton-authored (channel-A drain of `63fa132`); HQ-ruled, Martin ratify queued.** Extends the GDPR fan-out of [ADR 0040](0040-gdpr-privacy-audit.md). Ports anyora ADRs 0068 and 0067 (2026-07-12) upstream via the skeleton, **adapted** to this repo's architecture.

## Context

The GDPR erasure fan-out (`PrivacyProcessor.eraseUser`, Art. 17) runs domain-handler `eraseUser` calls, then the built-in core erasures (anonymize the Better Auth `user` row, delete `session`/`account` — and, here, the `twoFactor` credential), then the third-party purge hooks (Sentry, PostHog). Two gaps carried over from ADR 0040's original wiring:

1. **The purge result was discarded.** `PurgeHook.purgeUser` returned `void`, and the processor awaited it without recording anything. A purge was a hope in a log, not an accounted-for step — the audit trail could not show whether a subject's telemetry data had actually been reached, and the Sentry hook was a silent log-only stub.
2. **No cross-cutting repair seam.** Some erasure invariants can only be repaired _after_ the entire fan-out completes, because a per-subject `eraseUser` cannot express them: by the time the invariant is observable, the subject linkage is gone (the anyora defunct-grant race, ADR 0067). There was nowhere for a handler to run such a second-pass repair.

## Decision

### PurgeOutcome read-model (ports anyora ADR 0068)

`PurgeHook.purgeUser` now returns a `PurgeOutcome` — `{ readonly status: "purged" | "documented" | "skipped"; readonly detail?: string }`:

- **`purged`** — the third party deleted the user, or the PII-free end-state already held (idempotent success, e.g. PostHog reports no such person / a 404 on re-run);
- **`documented`** — no per-user deletion API exists, so the obligation is recorded and the data is minimized at source instead (the Sentry hook);
- **`skipped`** — the integration is unconfigured.

There is deliberately **no `"failed"` variant**. A hard failure (PostHog non-2xx lookup, non-2xx-non-404 deletion) **THROWS** — the job fails, retries, and DLQs via the existing `onFailed` handler (the ban-purge escalation shape, anyora ADR 0056). A purge failure is a thrown job, never a swallowed return. Purge outcomes also **do not downgrade erasure success** — a `documented`/`skipped` outcome is a successful, recorded step.

The processor collects the outcomes into `purges: Record<hookName, PurgeOutcome>` and records them via two mechanisms this repo already has.

**ADAPTATION — no `erasure_request` lifecycle table here.** anyora's ADR 0068 wrote the outcomes to a new additive `erasure_request.purges` jsonb column. That table is anyora's own (its ADR 0064 erasure-lifecycle read-model), **not** ours — this repo has no such table and, per [ADR 0107](0107-tenancy-app-level-scoping-not-rls.md), no lifecycle read-model to hang a column off. **No `erasure_request` table, no `purges` column, and no DB migration are introduced here.** Instead the read-model is recorded via:

- **the `privacy.erase` audit row's `diff` field** — `AuditService.record` already accepts `diff?: Record<string, unknown>`, so the processor writes `diff: { purges }`; and
- **the BullMQ `job.returnvalue`** — `eraseUser` returns the `purges` record and `process()` returns it for the erase case, so BullMQ stores it on the completed job.

Both are pollable, durable records of what each third party did, without adding a schema surface.

### `finalizeErasure` second-pass seam (ports anyora ADR 0067, generic seam only)

`PrivacyHandler` gains an optional `finalizeErasure?(userId: string): Promise<void>`. The processor runs it for every handler in a **second loop AFTER the entire `eraseUser` fan-out** has completed (and before the built-in core erasures) — so cross-module deletes another handler owns are already applied. A handler uses it to repair a cross-cutting invariant its own per-subject `eraseUser` cannot express, because by loop-end the subject linkage is gone.

Only the **generic seam** is ported. anyora's concrete `CareGrantsPrivacyHandler.finalizeErasure` (its defunct-grant sweep) is an anyora domain concern and is **not** brought over. The reference `ProjectsPrivacyHandler` needs no such repair and is left unchanged — the seam is merely available for a module that does.

### Item 2d (force-rls drift-guard) — N/A here

anyora's M0 set also widened a `FORCE ROW LEVEL SECURITY` drift-guard. **This is N/A here:** [ADR 0107](0107-tenancy-app-level-scoping-not-rls.md) rejected RLS/FORCE-RLS entirely (tenant isolation stays app-level, scoped repositories). There is no RLS guard to widen, so nothing is changed in code for that item.

## Consequences

- The audit trail and `job.returnvalue` now show, per erasure, what each third party did — `purged` / `documented` / `skipped` — closing the "purge is a hope" gap without pretending Sentry can hard-delete and without a new schema surface.
- The Sentry purge is an honest documented-stub: `documented` with `SENTRY_DSN` set, `skipped` unset, making no fabricated call. Its honesty rests on PII being scrubbed at source (`sendDefaultPii: false` + the `beforeSend` scrubber, now covering request body/URL/querystring/referer/breadcrumbs per [ADR 1009](1009-sentry-request-pii-scrub.md)).
- `finalizeErasure` is a general seam available to any future handler; it adds one optional interface method and a second loop in the processor. No behaviour change for handlers that do not implement it.
- No RLS surface (ADR 0107), no `erasure_request` table, no migration, no new telemetry dependency in the privacy module.
- Coverage (all non-vacuous): unit tests for both hooks' outcomes (Sentry documented/skipped; PostHog purged / skipped / idempotent-absent / 404-as-success / throws-on-lookup-failure / throws-on-delete-failure escalation); processor tests assert the purge outcomes reach both the audit `diff` and the returned `job.returnvalue`, that a thrown hook propagates without an audit write, and that `finalizeErasure` runs in a second pass after every `eraseUser` and before core.

## Sources

- anyora ADR 0068 — "Purge-hook outcomes are a first-class erasure read-model; the Sentry purge is an honest documented-stub" (the read-model + escalation port source).
- anyora ADR 0067 — "Defunct-grant closure: a post-fan-out `finalizeErasure` sweep" (the second-pass seam port source; only the generic seam is ported).
- [ADR 0040](0040-gdpr-privacy-audit.md) — the GDPR export/erase fan-out this extends.
- [ADR 0107](0107-tenancy-app-level-scoping-not-rls.md) — why item 2d (force-rls) is N/A here.
