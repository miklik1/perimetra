# ADR 0040 — GDPR plumbing: privacy module, audit log, PII registry, retention

**Status:** Accepted (2026-06-11). Implemented; live-probed (export to MinIO,
real user-row anonymization).

## Context

EU client work makes Art. 15/17/20/30 obligations universal across derived
projects, and erasure is structurally hard here because personal data fans out
across exactly the surfaces this skeleton adds: Better Auth tables, S3
objects, job payloads, logs, and (Phase 6) Sentry/PostHog. Retrofitting this
per project is weeks; the skeleton standardizes it once.

## Decision

- **PII registry** (`@repo/db/pii`, ADR 0032): every personal-data column is
  declared at schema-definition time — one source of truth for erasure,
  export, and (Phase 6) log redaction.
- **Privacy module:** `PrivacyHandler` interface
  (`exportUser`/`eraseUser` per entity type) registered by domain modules;
  self-service `POST /v1/privacy/export` and `/erase` (202 → queued).
  Worker processor: export fans handlers out into one JSON stored at
  `privacy-exports/<userId>/<uuid>.json` in S3 (delivery link is a follow-up);
  erase runs handlers, then the built-in core: Better Auth user row
  anonymized (`erased-<id>@erased.invalid`, image null), sessions/accounts
  deleted, purge-hook seam fired (no-op until Sentry/PostHog adapters land,
  Phase 6), and the erasure itself audit-logged.
- **Audit module:** append-only table (actor, action, entity, before/after
  diff, request id from CLS) written via the AMBIENT transaction when one is
  active and **fail-soft always** — audit must never fail the business
  operation. The reference resource demonstrates create/update/archive/delete
  trails.
- **The IDs-only rule** (ADR 0037) is what keeps Redis/job payloads out of
  scope for erasure — re-affirmed here as a GDPR control, not just an ops
  nicety.
- **Retention as scheduled jobs:** outbox 30d (ADR 0037), audit 2y — deleted
  via a UUIDv7 time-boundary on the PK index (no created_at scan).

## Consequences

- A new domain module is GDPR-complete by registering one `PrivacyHandler`
  and using `pii()` on its columns — the projects module is the template.
- Known gaps (tracked): no domain handler registered yet (export `data` is
  empty until the projects handler lands), export download delivery, and the
  Sentry/PostHog purge adapters (Phase 6).

## Amendment (2026-07-16) — `Referer` added to the static log-redact paths

Channel-A drain of skeleton `7e9ba3b`. `req.headers.referer` joins the static
redact-path set (alongside `authorization` / `cookie` / `set-cookie`). A browser
that opened a token-bearing URL — a password-reset / magic / signed-export link,
and `sendResetPassword` already mints one — replays that URL as the `Referer` of
the next same-origin request, so a single-use credential can land in the access
log in cleartext (orthogonal to TLS, which protects the wire, not the URL's
persistence). The censor is a whole-header `redact.paths` entry — the SAME
mechanism as cookie/authorization, NOT a `req` serializer edit. Because a
redact-path is invisible to a serializer-only unit test, a real pino-http
round-trip test asserts the header renders `[redacted]` and mutation-reddens if
the path is removed.
