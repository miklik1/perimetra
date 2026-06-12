# ADR 0035 — Infra modules: email, storage, realtime, rate limiting

**Status:** Accepted (2026-06-10). Implemented; every module live-probed
end-to-end against the compose stack. Closes the consumer side of
[ADR 0029](0029-realtime-package-centrifugo.md) (the `@repo/realtime` seam
finally has a backend).

## Decisions

**Email (spec §7.4)** — provider-agnostic `EmailSender` seam + nodemailer SMTP
adapter (Mailpit dev). Templates are react-email TSX and TRANSLATION-AGNOSTIC
(final strings as props); `EmailService` translates via the shared ICU
catalogs (`use-intl/core` `createTranslator` over `@repo/i18n`) —
transactional email arrives in the user's locale (cs/en), the EU table-stake
designed in. Better Auth's verification mail rides this seam
(`sendOnSignUp`). Proven: signup → Czech subject in Mailpit.

**`@repo/i18n` dual build** — the api consumes a BUILT `./server` subpath
(neutral core: locale identity + catalogs, no React). Source stays
extension-less (Turbopack/Metro/Jest resolve it natively; explicit `.js`
specifiers in source broke all three bundlers — tested), and the build
appends `.js` to emitted js+d.ts via `tsc-alias` `resolveFullPaths`. This is
the repo's pattern for any shared package that gains a backend consumer.

**Storage (spec §7.5)** — S3 presigned URLs (AWS SDK v3): content type AND
length are SIGNED (`signableHeaders`), so limits are cryptographic;
`forcePathStyle` + checksum-mode compat for MinIO; key convention
`<module>/<entityId>/<uuid7>` (erasable per aggregate, ADR 0040); presign
endpoint session-guarded with a content-type allowlist. `S3_ENDPOINT` must be
the browser-reachable host (presigned URLs embed it). Proven: presign → PUT →
byte-identical readback.

**Realtime (spec §7.3)** — Centrifugo v6: connection + subscription JWTs
(jose HS256; `sub` = user id as string), channel convention `user:<id>` /
`org:<id>` with fail-CLOSED authorization (`org:` denied until the ADR 0041
tenancy seam fills in membership); publisher via the v6 HTTP API
(`POST /api/publish`, `X-API-Key`; v6 reports errors in an HTTP-200 body —
checked). Publish FAILS SOFT: realtime is a notification channel, never a
source of truth. Gotcha encoded in compose config: v6 requires `user`/`org`
declared as channel namespaces. Proven: tokens, foreign-channel 403, publish
`{"result":{}}`.

**Rate limiting (ADR 0044 baseline)** — two layers because the auth mount
lives outside Nest's router: `@nestjs/throttler` (Redis storage,
`@nest-lab/throttler-storage-redis`) as a global guard for controller routes,
and `@fastify/rate-limit` (per-IP, `skipOnError`) on the raw `/api/auth/*`
route. Proven: 429s exactly past `AUTH_RATE_LIMIT_MAX`.

## Consequences

- Per-project provider swaps (SES/Resend, R2/S3, Ably) are adapter changes
  behind seams, not refactors.
- The frontend `@repo/realtime` Centrifuge adapter can now be wired against
  `/v1/realtime/token` (frontend wiring lands with the reference resource,
  Phase 5).
