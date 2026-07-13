# privacy — GDPR export & erasure plumbing (ADR 0040)

User-facing GDPR machinery: `exportUser` (Art. 20) and `eraseUser` (Art. 17)
run as BullMQ jobs on the `privacy` queue and fan out across every store via
registered handlers — driven by the `pii()` column registry in `@repo/db`.

## Public surface

- `PrivacyService.requestExport(userId)` / `.requestErasure(userId)` —
  enqueue the jobs (idempotent via jobId dedup); `privacy.controller.ts`
  exposes them at `/v1/privacy/*` for the signed-in user.
- `PRIVACY_HANDLERS` multi-provider token + `PrivacyHandler` interface
  (`exportUser` / `eraseUser`) — every domain module owning user data MUST
  register one (see `projects/projects.privacy.ts`; generator-scaffolded).
- `PURGE_HOOKS` + `purge/` — third-party stores: PostHog person deletion,
  Sentry PII scrub. S3 objects are covered by domain handlers; the Better
  Auth core tables (`user`/`session`/`account`) are NOT a handler's — the
  processor handles them inline as built-in core steps: erasure anonymizes
  the `user` row and deletes `session`/`account`, and export emits the ruled
  `user` identity/preference fields (ADR 1004).

## Rules that bite

- Soft-deleted PII is still PII — erasure reaches archived rows too. A new
  table with `pii()` columns and no registered handler is a compliance bug.

## Must never

- Import domain schemas directly — erasure goes through each module's
  handler so ownership stays with the module.

Governing ADR: `docs/adr/0040-gdpr-privacy-audit.md`.
