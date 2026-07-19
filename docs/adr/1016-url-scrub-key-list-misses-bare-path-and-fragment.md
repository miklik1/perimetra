# ADR 1016 — The URL scrub's key lists missed the bare path+query attribute and the fragment twins

**Status:** Accepted (2026-07-19). Amends [ADR 1011](1011-client-sentry-url-query-scrub.md), whose key lists this extends. Drained from skeleton `2012000` (upstream ADR 1016), where it was found during the drain of downstream fixes made in `booking` and `anyora-platform` against `2f83b8d`; every claim below was re-checked against this repo's own source and its installed SDK bundles.

This ADR records **one decision applied to two key lists**, not two decisions. Both gaps are the same defect: a field whose value is URL-derived but whose _shape_ defeats every value-level defence in `scrub.ts`, so the only rule that can catch it is its key NAME — and the name was absent from the list. Grouping them keeps the rationale in one place, because the rationale is identical.

## Context

`packages/telemetry/src/scrub.ts` defends a URL query on two independent levels. The **value** level (`stripEmbeddedUrlQueries`) finds a URL inside arbitrary free text and cuts its query. The **name** level (`URL_KEYS`, `QUERY_ONLY_KEYS`, `PATH_KEYS`) acts on fields already known to hold a URL, a bare query, or a path. The value level is the safety net; the name level is the precise rule. ADR 1011 established both, and [ADR 1013](1013-posthog-analytics-url-scrub.md) — together with its upstream correction, skeleton ADR 1015 — hardened the value level.

Two real attribute names reached neither.

**1. `http.target` — path+query, not an absolute URL.** Its value looks like `/clients?search=Nováková`. `stripEmbeddedUrlQueries` requires either a `://` or a dotted `//host`; a bare path has neither, so both of its passes are a no-op. `SENSITIVE_KEYS` is anchored and contains no `target`; `QUERY_ONLY_KEYS` and `STRUCTURAL_KEYS` do not match. The key therefore fell to the default `scrubValue` branch and the querystring survived verbatim.

The attribute is not exotic. This repo's `apps/web` is a Next.js app, and Next.js sets `http.target` unconditionally on the `BaseServer.handleRequest` root span — a span on `NextVanillaSpanAllowlist`, so it ships without `NEXT_OTEL_VERBOSE`. Sentry's own `httpServerSpansIntegration` sets it as well. Neither is gated on `sendDefaultPii`. Sentry reads the value only to NAME the span, against a stripped copy, and never deletes the attribute; Sentry's OTel bridge then maps span attributes straight onto `contexts.trace.data` and `spans[].data`. The raw value therefore rode the whole server tracing path in the clear.

The exposure is squarely in this product's domain: a `?search=` on the configurator, quote and project routes carries customer surnames and the odběratel fields ADR 0071/0082 registered as `pii()`.

**2. `url.fragment` / `http.fragment` — the fragment twins.** `QUERY_ONLY_KEYS` already covered `url.query` and `http.query`. The SDK writes the fragment attribute on the source line adjacent to the query one, in four separate code paths of the installed SDKs: browser xhr spans (`@sentry/browser` `tracing/request.js`), the fetch path (`@sentry/core` `fetch.js`), outgoing-request breadcrumbs (`@sentry/core` `integrations/http/add-outgoing-request-breadcrumb.js`), and the OTel bridge (`@sentry/opentelemetry` `resource-*.js`). Two further writers exist beyond those four (`@sentry/core` `utils/url.js` writes `url.fragment`; `@sentry/node-core` `utils/outgoingFetchRequest.js` writes `http.fragment`), so "four places" undercounts rather than overclaims.

A bare fragment value has no scheme, so `stripEmbeddedUrlQueries` never fires and `dropUrlQuery` is never reached. An arbitrary `#…` param has no value shape for the pattern pass to catch — which is precisely the rationale for the deny-by-default query cut in the first place. Covering the query key but not its fragment sibling also contradicted this module's own policy: `dropUrlQuery` cuts at `[?#]`, not just `?`, i.e. the module already treats a fragment as unsafe everywhere it can see one.

## Decision

1. **`http.target` joins `URL_KEYS`**, so it routes through `scrubUrlValue` like the absolute URL forms: the path is kept (route debuggability) and the query is dropped.
2. **`url.fragment` and `http.fragment` join `QUERY_ONLY_KEYS`**, so their whole value is dropped to `[Filtered]` — there is no path component worth keeping in a bare fragment.

Both consumers of these lists pick the change up with no further edit: the event walk (`scrubValue`) and `scrubSpan`'s `scrubDataEntry` dispatch on the same predicates. `sentry-options.ts` wires `beforeSend`, `beforeBreadcrumb`, `beforeSendTransaction` and `beforeSendSpan` to those walks, so all four envelope paths are reached transitively; `beforeSendTransaction: scrubEvent` is specifically what covers `contexts.trace.data` and `spans[].data`, the carriers named above.

**One tempting rationale is rejected as false.** A sibling repo justified the fragment fix by asserting that the SDK parses a URL once and writes the query and fragment attributes _together_, so a covered key always shields its twin. The SDK source refutes this: the two writes are independently guarded on `parsedUrl.search` and `parsedUrl.hash`. A URL with a fragment and no querystring (`/path#email=jan@example.cz`) emits `http.fragment` with no `http.query` beside it. That co-occurrence invariant does not exist, and stating it in a contract artifact would claim coverage the code does not provide. A test pins the independence so the wrong rationale cannot be reintroduced.

## Consequences

- **Scope of the `http.target` closure.** This closes the path+query attribute on the **server tracing** path. Error events were never affected: `spanToTraceContext` carries only trace/span/parent ids and no `data`, so exposure required `tracesSampleRate > 0`. The mobile binding shares this scrubber but does not set `http.target` — this is a server-tracing fix, not a universal one.
- **Accepted cost:** a fragment used for legitimate in-page navigation state is now lost from telemetry entirely. A fragment is attacker- and user-controlled free text with no shape; dropping it is the only fail-safe option.
- Both gaps are pinned by tests in `packages/telemetry/src/scrub.test.ts` that assert against the real attribute shapes on the real envelopes — `contexts.trace.data`, `spans[].data`, and the raw `scrubSpan` envelope — plus a composition case proving the surviving path is still shape-redacted, and a fragment-without-query case. Each fails on the pre-fix regexes; this was verified by reverting the two regexes and re-running the suite.
- ADR 1011's field enumeration is **not** edited in place; the repo's rule is supersede, don't rewrite history. This ADR is the current statement of both key lists.
- **Generalisation.** Both gaps share one shape: the value-level defences are shape-based, and a field carrying a _relative_ or _bare_ URL fragment has no shape to match. Whenever the SDK gains an attribute holding a URL PIECE rather than a whole URL, only the name list can catch it. Adding a new URL-derived key without asking "does the value-level pass actually fire on this shape?" is how both of these were missed.
- **A related comment-only guard shipped alongside** in `packages/telemetry/src/sentry-options.ts`: an app that wraps one hook to add app-specific redaction must wrap all four, because re-specifying a subset is well-typed and silent. That is a documentation fix to an existing invite, not a new decision, and no app in this repo currently composes hooks that way.

## Sources

- [ADR 1011](1011-client-sentry-url-query-scrub.md) — the deny-by-default URL scrub whose key lists this extends.
- [ADR 1013](1013-posthog-analytics-url-scrub.md) — this repo's hardening of the value level; its upstream correction is skeleton ADR 1015, which explicitly did not touch the key lists.
- Installed SDK bundles (`@sentry/browser`, `@sentry/core`, `@sentry/opentelemetry`, `@sentry/node-core`) read for the fragment/query emission sites.
- Skeleton `2012000` (upstream ADR 1016), draining downstream fixes from `booking` and `anyora-platform`.
