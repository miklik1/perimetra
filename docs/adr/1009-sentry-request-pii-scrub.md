# ADR 1009 — The Sentry event scrubber drops the request body, URL querystring, referer and breadcrumb query surfaces

**Status:** Accepted (2026-07-16) — **Skeleton-authored (channel-A drain of `63fa132`); HQ-ruled, Martin ratify queued.** Amends the scrubbing half of [ADR 0040](0040-gdpr-privacy-audit.md). Ports anyora ADR 0070 (2026-07-13) upstream via the skeleton.

## Context

`scrubEvent` (the `beforeSend` hook in `apps/api/src/sentry/init.ts`) already dropped `event.request.cookies`, three named request headers (`cookie`/`authorization`/`set-cookie`), and key-matched `event.extra` / `event.contexts` against the `pii()` registry. Tracing `@sentry/node` 10.57 (the version this repo pins) showed five more request-derived PII surfaces left untouched, all populated by Sentry's **default** integrations regardless of `sendDefaultPii: false`:

1. **`event.request.data` — the raw request body.** The default `httpIntegration` buffers up to `maxRequestBodySize` (default `"medium"` = 10 KB) of the unparsed body, which `requestDataIntegration` copies into `event.request.data` before `beforeSend` runs. It is an unparsed string blob, so the registry key-scrub (which only walks keyed objects) structurally cannot reach it — every `req.body.<piiKey>` path `buildRedactPaths()` enforces for pino had zero effect on Sentry. On a 500 during a `pii()`-column-bearing `POST`, the full body could ship unredacted.
2. **`event.request.url` — the full URL including querystring.** The same `?q=<email>` leak class that `stripQueryString` closes for pino rides into Sentry through a separate path: the pino serializer only reshapes the copy handed to pino, never the raw request Sentry instruments.
3. **`event.request.query_string` — the parsed querystring**, attached alongside the URL and equally unscrubbed.
4. **`event.request.headers.referer` / `referrer` — the origin page URL with querystring.** `requestDataIntegration` copies all headers verbatim; the `apps/web` same-origin proxy means the browser sends `Referer: /clients?search=<email>` — the same `?q=<email>` pattern, on a header the 3-name delete list missed.
5. **`event.breadcrumbs[].data["http.query"]` / `["http.fragment"]` and `data.url` — outgoing-request querystrings.** The default `Http`/`NodeFetch` integrations add a breadcrumb per outgoing request with the raw querystring in `data["http.query"]` (the `data.url` is Sentry-sanitised, the query field is not). Concretely live: the PostHog purge calls `fetch(.../?distinct_id=<userId>)`, so an erased subject's id rides into a breadcrumb. `scrubEvent` never inspected `event.breadcrumbs`.

Because `captureException` fires for every unhandled error, any error on a PII-bearing request could carry these fields to Sentry.

## Decision

**The `beforeSend` scrubber is the single terminal guarantee.** `scrubEvent` now, on `event.request`: `delete`s `data`; strips the querystring off `url` by **reusing `stripQueryString` from `common/logging/redaction.ts`** (one definition of "cut the querystring" — the two observability submodules already share the `pii()` registry, so this is a deliberate single-source reuse, not a redefinition); `delete`s `query_string`; and deletes the `referer`/`referrer` headers alongside the existing three. It then walks `event.breadcrumbs` (guarded for absent array / absent `data`), deleting each `data["http.query"]` / `data["http.fragment"]` and stripping the querystring off any `data.url`. `beforeSend` is the last step before transport, so these fields are buffered transiently by Sentry's integrations but never leave the process — the scrub is independent of any integration behaviour or future regression.

**Source-level minimisation was considered and rejected as version-fragile.** Disabling body capture at the source (`maxRequestBodySize: "none"`) would be the GDPR-preferred "never collect it" posture, but `@sentry/node` 10.57 does not expose `maxRequestBodySize` on the default `httpIntegration` (name `"Http"`); the option lives on a separately-named integration that would be _added_ rather than override `"Http"` by name, so it would not actually disable the default capture. Rather than pin to a fragile internal shape, the terminal scrub is the sole, robust mechanism.

## Consequences

- All five request PII surfaces are closed; the "PII is scrubbed at source" claim the Sentry purge hook rests on (see [ADR 1010](1010-erasure-plumbing-generalized.md)) is now actually true for request data, not only for `extra`/`contexts`/headers.
- `sentry/init.ts` now depends on `common/logging/redaction.ts` for `stripQueryString` — a relative import (`../common/logging/redaction.js`, both under `apps/api`).
- **Logging/telemetry only.** There is no request-handling, RLS, or migration surface: `beforeSend` runs entirely inside the error-reporting path, changes no stored data, and touches no request/response the application serves.
- Coverage: `sentry/init.test.ts` gains cases asserting each of the five surfaces is dropped and that **no PII term survives anywhere** in the serialized event, plus tolerance of absent breadcrumbs / breadcrumb `data`. The cases are non-vacuous — removing any single `delete`/strip reddens a test.
- Future-conditional risks to re-audit on any `@sentry/*` bump (recorded, not fixed, matching anyora ADR 0070): `localVariablesIntegration` (unset here) would expose raw stack-frame vars `scrubEvent` never touches; `consoleIntegration` turns `console.*` into breadcrumbs from raw args and an interpolated `throw new Error(\`...${pii}\`)` ships its message untouched — key-based scrubbing cannot reach free-text PII (no such call site exists today). A deny-by-default header allow-list remains the more robust structural follow-up.

## Sources

- anyora ADR 0070 — "The Sentry event scrubber drops the request body, URL querystring and query_string" (the upstream port source; found by the adversarial review of anyora's pino-serializer fix).
- [ADR 0040](0040-gdpr-privacy-audit.md) — the scrubbing baseline this amends.
- `apps/api/src/common/logging/redaction.ts` — `stripQueryString`, the single-source querystring cut reused here.
