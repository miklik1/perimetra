# ADR 1004 — GDPR/DSAR export includes the Better Auth core user row (portable-field scope)

**Status:** Accepted (2026-07-12) — **HQ-ruled default, Martin ratify queued** (do-first doctrine 2026-07-12, ruling #1). Amends [ADR 0040](0040-gdpr-privacy-audit.md) (its export half only; the erase half is unchanged).

## Context

`PrivacyProcessor.eraseUser()` (Art. 17) has always had a built-in **core** step: it anonymizes the Better Auth `user` row (name/email → `erased-<id>@erased.invalid`, image null) and hard-deletes the `session`/`account` rows. `PrivacyProcessor.exportUser()` (Art. 20) had **no** matching core step — it built the export document purely from the registered domain `PrivacyHandler`s and never read the `user` table. So a subject's erasure destroyed their core identity row, but their export of that same identity — name, email, avatar, locale, timestamps — was simply absent from the JSON they downloaded. ADR 0040's own Decision section described a built-in core only for erase, confirming the asymmetry was a design gap, not an oversight in wiring (finding: "GDPR export is handler-only — the core Better Auth user row is anonymized on erase but never exported").

The open question ADR 0040 left (and the finding's owed CHECK 2026-07-05) is the **portable-field scope**: exactly which `user` columns belong in a self-service Art. 15/20 export. The `user` table carries user-supplied identity (`name`, `email`, `image`), system identity/record metadata (`id`, `emailVerified`, `createdAt`, `updatedAt`), a preference (`locale`), and admin() moderation flags (`role`, `banned`, `banReason`, `banExpires`). `me.controller.ts` already treats the moderation flags as internal (an explicit client allow-list of `{id,email,name,createdAt}` with a comment that the admin() fields must never reach the client). This is a legal/product judgement the skeleton must set a defensible default for.

## Decision

`exportUser()` gains a built-in core step, symmetric with the existing erase-side core step, that emits the `user` row under the reserved `data.user` key. The exported field set is an **explicit, fail-closed allow-list** — exactly:

`id, name, email, emailVerified, image, locale, createdAt, updatedAt`

It **excludes** the admin() moderation flags (`role`, `banned`, `banReason`, `banExpires`) as internal, and never reads `account` (password hash, OAuth tokens) or `session` (session artifacts). No domain handler may claim the `"user"` entityType.

An explicit allow-list (not a strip-list) is deliberate: a column added to the `user` table later does **not** enter the export until it is listed here on purpose. A `privacy.processor.test.ts` contract test pins the exact emitted key set (the eight fields + the ADR-0040 `category` envelope marker) and asserts the moderation flags and `password` are absent — this is the regression guard, because the existing `privacy-handlers.pii-contract.test.ts` passes vacuously for `user` (its `coveredBy` predicate only checks that the processor _imports_ the `user` schema, which the erase side already does).

## Consequences

- A subject's Art. 20 export now contains their own identity + preference data, matching what erasure removes. The exclusion of moderation flags is the defensible default (they are abuse-prevention internal state, mirrored on `me.controller.ts`); Art. 15's "right to know about processing concerning them" is a per-project legal call a derived project can widen with its own documented decision, exactly as `privacy.tokens.ts` already punts special-category classification.
- The step is handled inline in the processor, NOT via `PRIVACY_HANDLERS`/`@gen:*` anchors — Better Auth's own tables are not a domain module, and the anchors are pinned byte-for-byte to the generator template by `privacy-generator.conformance.test.ts`. Growing a second registration pathway for one table would fight that guard for no benefit.
- **HQ-ruled default (ratify queued):** the field set is HQ's engineering call under the do-first doctrine; Martin's (or legal's) ratification/veto is queued in the Brain hub. The contract test makes any future change to the set a deliberate, reviewed edit.
- Out of scope (flagged, not silently assumed covered): the export path has no Art. 30 audit row today (only erase does); and `account`/`session` are erased but never exported — if scope later grows to "export everything Better Auth erases", those need their own heavily-redacted handling (password/tokens excluded).

## Sources

- [ADR 0040](0040-gdpr-privacy-audit.md) — the GDPR export/erase fan-out this amends.
- Vault decision: "do-first doctrine & blocker triage (2026-07-12)", ruling #1 (the ruled field set).
- Engineering finding: "GDPR export is handler-only — the core Better Auth user row is anonymized on erase but never exported".
- `apps/api/src/modules/auth/me.controller.ts` — the internal-vs-client-facing precedent for the moderation flags.
