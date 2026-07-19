# ADR 1017 — The scrub's key lists missed container keys and the SDK's attribute-namespaced PII names

**Status:** Accepted (2026-07-19) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Amends [ADR 1011](1011-client-sentry-url-query-scrub.md) and extends [ADR 1016](1016-url-scrub-key-list-misses-bare-path-and-fragment.md), whose key lists this widens. Drained from skeleton `2012000` (upstream ADR 1017), where it was found by adversarial review of the same downstream drain that produced 1016; every claim below was re-checked against this repo's own source and its installed SDK bundles.

ADR 1016 closed two missing NAMES. This ADR closes the two structural reasons a name goes missing, because after fixing 1016's instances the same defect was still live three more times — twice on the **error** path, which 1016 explicitly did not reach.

## Context

`SENSITIVE_KEYS` is a fully anchored alternation of bare `pii()` column names plus a generic credential vocabulary. The anchoring is deliberate and correct: it is what stops `cookie` from swallowing `cookiePreferences`. But an anchored bare-name list is structurally blind in two directions, and the SDK emits PII in both of them.

### 1. Container keys — the child names are not a vocabulary we own

`event.request.cookies` is the parsed cookie **jar**. `requestDataIntegration` is a DEFAULT integration (`@sentry/node-core` `sdk/index.js`) and `extractNormalizedRequestData` sets `requestData.cookies = normalizedRequest.cookies || parseCookie(headers.cookie)` whenever `include.cookies` is truthy. With `sendDefaultPii: false` the default is `cookies: { deny: [...] }` — an **object**, therefore `!== false`, therefore truthy. Crucially the EVENT path applies **no filtering at all**; only the SPAN path routes cookies through `filterKeyValueData`. And this runs in `processEvent`, so it is the **error** path: `tracesSampleRate: 0` is no protection.

The plural `cookies` did not match the anchored singular `cookie`, so the walk descended into the jar and tested each **cookie name** against the same anchored list. This repo's own production session cookie is `__Host-auth_session_token` (`packages/auth`) — it matches neither `token` nor `access[-_]?token` nor `refresh[-_]?token`, all anchored. The value then fell to `redactString`, where no shape fires: a Better Auth session token is two dot-separated segments and the JWT pattern needs three.

The result was an httpOnly `__Host-` session token — hardened precisely so JS cannot read it — shipped verbatim to a third-party SaaS on every server error under default config, sitting in the same event as the `headers.cookie` copy of the **same secret** that this module already redacts one key away.

`event.request.data` is the second container, and a worse one: the raw **unparsed body** string. `include.data` is hardcoded `true` in `requestDataIntegration` ("Always attach body data that's already on the scope"), and `httpServerIntegration` captures `maxRequestBodySize: "medium"` (10KB) by default. `@sentry/nextjs` passes `disableIncomingRequestSpans: true`, but that flag gates only `serverSpans` — `httpServerIntegration.setupOnce()` runs unconditionally, so the Next.js server runtime captures bodies too. Being a string, no key rule can reach inside it and only `redactString` runs; an ordinary Czech form post (`surname=Nováková&note=…`) carries no Bearer/JWT/email/rodné-číslo shape, so nothing fires.

Both fields were already adjudicated by this repo: `apps/api/src/sentry/init.ts` deletes both wholesale in its own `beforeSend` (ADR 1009). The shared scrubber that `apps/web` depends on did not — exactly the one-binding-hardened asymmetry `sentry-options.ts` warns about a level up.

### 2. Attribute-namespaced forms of names the list already owns

`SENSITIVE_KEYS` declares `ip[-_]?address` and `user[-_]?agent` to BE PII. Anchoring makes both blind to the namespaced attribute forms the SDK actually emits — and those are written as plain literals in the **same `startSpan` attributes bag as `http.target`**, the very literal ADR 1016's fix was read out of (`@sentry/core` `integrations/http/server-subscription.js`, verbatim again in `@sentry/node-core` `httpServerSpansIntegration.js`):

```
"net.host.ip": localAddress,
"net.peer.ip": remoteAddress,
"http.target": urlObj ? `${urlObj.pathname}${urlObj.search}` : …,   ← fixed by 1016
"http.client_ip": typeof ips === "string" ? ips.split(",")[0] : void 0,
"http.user_agent": userAgent,
```

None is gated on `sendDefaultPii`; `ips` is `headers["x-forwarded-for"]`. `spanToTransactionTraceContext` spreads the whole bag onto `contexts.trace.data`, so they reach `beforeSendTransaction` by exactly the route ADR 1016 documents. Elsewhere in the same SDKs: `user_agent.original` (`get-outgoing-span-data.js`), `client.address`, `http.request.header.user_agent` (`@sentry/browser` `httpcontext.js`), and `http.request.body.data` — the **span twin** of `event.request.data`, written by `requestdata.js` from the same raw body.

`ip_address` and `user_agent` are registered `pii()` columns of this repo's Better Auth `session` table (ADR 0040), so the namespaced forms leak exactly the data the registry mirror claims to own.

Sentry itself classifies this data as PII: its `PII_HEADER_SNIPPETS` deny-list (`forwarded`, `-ip`, `remote-`, `via`, `-user`) catches the `x-forwarded-for` **header**. But that list is applied only to header/cookie/query attributes, never to the plain literals above — so the SDK filters `http.request.header.x-forwarded-for` while letting the identical value through as `http.client_ip`.

## Decision

1. **`cookies` joins `SENSITIVE_KEYS`.** The container is dropped wholesale. This is a container-level claim and nothing more: per-cookie-name coverage is _not_ improved, because a cookie name is not drawn from any vocabulary this list can enumerate. Dropping the jar is what makes enumeration unnecessary.
2. **A new `REQUEST_SCOPED_SENSITIVE_KEYS` drops `data` — but only as a direct child of `request`.** The walk gains one level of parent context (`underRequest`), set only when the immediate parent key was `request`. It is deliberately not a path stack; the single rule that needs it cares about a direct child of Sentry's request interface and nothing deeper.
3. **A new `SENSITIVE_ATTRIBUTE_KEYS` covers the SDK attribute forms**: `http.client_ip`, `net.peer.ip`, ~~`net.host.ip`~~ (retired by [ADR 1019](1019-analytics-array-key-credential-vocabulary-and-net-host-ip.md)), `client.address`, `http.user_agent`, `user_agent.original`, `http.{request,response}.header.user_agent`, `http.request.body.data`, and the `http.{request,response}.header.{cookie,set_cookie}` family (a prefix rule, covering the bare attribute and its `.<cookie_name>` children).

A helper `isSensitiveKey()` ORs the two lists and is used at **both** dispatch sites — the event walk and `scrubSpan`'s `scrubDataEntry` — so the two cannot drift.

**Why `data` is scoped rather than global.** `data` is one of the most load-bearing key names in a Sentry envelope: `spans[].data` and `contexts.trace.data` are the attribute bags every URL rule in this module operates on, and breadcrumbs carry `data` too. A global `data` rule would redact the bag _before_ the walk could reach `http.target`, `http.query` or the fragment twins inside it — trading a leak for a strictly bigger blind spot. A test pins this so the scoping is not "simplified" away.

**Why `SENSITIVE_ATTRIBUTE_KEYS` is a separate const.** `SENSITIVE_KEYS` is the hand-mirror of the `pii()` column registry and `scrub.pii-contract.test.ts` guards it against registry drift; it must stay a list of bare **column** names. The attribute names come from a different source of truth (the installed SDK bundles), and merging them would make the mirror unreadable to both the human and the drift test.

**Why both `net.host.ip` and `net.peer.ip`.** ~~Which of the two is the remote party depends on the span's direction — on a server span the peer is the caller, on a client span the host is us — and the attribute name alone does not carry the direction. There is no local test that keeps the server's own address while dropping the caller's, so both are dropped.~~ **RETRACTED by [ADR 1019](1019-analytics-array-key-credential-vocabulary-and-net-host-ip.md).** This rationale is false and the rule it justified is retired. `net.host.ip` has exactly two emitters in the installed tree and both are SERVER spans assigning `localAddress`; the client-span emitter writes only `net.peer.*` and never `net.host.*`. The attribute name _does_ carry the direction. `net.peer.ip` remains on the list on its own merits — on a server span it is the caller's IP.

## Consequences

- **The error path is now covered, not just tracing.** ADR 1016's closure required `tracesSampleRate > 0`. The `cookies` and `request.data` gaps did not: both ride `beforeSend`, so they were live under this repo's default `tracesSampleRate: 0`. This is the more severe half of the drain.
- **Accepted cost.** Request bodies and cookie jars are gone from telemetry entirely, and client IP / user-agent are gone from span attributes. Route, method, status and `http.route`/`net.host.name` are untouched, so trace debuggability and issue grouping survive; a test pins that.
- **Scope of the claim.** These rules cover the fields named above on the four envelope paths `sentry-options.ts` wires. They are not a guarantee that every string in an event is reached — the module's defence is a deny-list of key names plus a deny-list of value shapes, and a shapeless value under an unlisted key still passes.
- **The generalisation, restated.** ADR 1016 said: a field carrying a URL _piece_ has no shape, so only the name list can catch it. This ADR adds the two ways the name list itself fails — a **container** whose child names are not ours to enumerate, and a **namespaced attribute form** of a name already on the list. Both were found inside code the previous fix had already read. When adding a key, ask both questions: does a value-level pass fire on this shape, and can the anchored name list actually see the form the SDK emits?
- **The api-side and shared scrubbers now agree.** ADR 1009's bespoke `beforeSend` deletes `request.cookies` and `request.data` for `apps/api`; the shared scrubber now does the same for every binding, so `apps/web` is no longer the weak one. The api-side deletes are kept rather than removed: they are the guarantee that does not depend on the shared module's key policy staying correct.
- **`underRequest` does not propagate through two paths, and that is reviewed and accepted — do not "fix" it blind.** Adversarial review of this drain raised both, independently, and both were refuted on reachability: (a) `scrubSpan`'s `scrubDataEntry` falls through to `scrubValue(value, new WeakSet())` without a parent-key argument, so a span attribute bag holding a nested `{request: {data: …}}` object misses the rule — but OTel span attributes are primitives or arrays of primitives, never nested objects, so no emitter can produce that shape, and the real span-side twin (`http.request.body.data`) is covered by NAME in `SENSITIVE_ATTRIBUTE_KEYS`; (b) `scrubValue`'s array branch recurses without carrying `underRequest`, so `{request: [{data: … }]}` misses it — but Sentry's request interface is an object, never an array. Both shapes are byte-identical to skeleton `2012000`, so changing either here would create a channel-A divergence to carry and owe upstream, bought with no closed leak. Recorded rather than fixed; if a future SDK ever emits either shape, fix it upstream first.
- Pinned by tests in `packages/telemetry/src/scrub.test.ts`. Several assert leaks that fail on the pre-fix regexes (verified by neutralising the rules individually and re-running); the rest pin the invariants the fix must not break — the `cookiePreferences` anchoring, the walkability of the `data` attribute bags, the direct-child scoping of `request.data`, and the survival of the non-PII attributes in the same literal.
- ADR 1011's and 1016's enumerations are **not** edited in place; supersede, don't rewrite history. This ADR is the current statement of the sensitive-key lists.

## Sources

- [ADR 1011](1011-client-sentry-url-query-scrub.md) — the deny-by-default URL scrub and the original key lists.
- [ADR 1016](1016-url-scrub-key-list-misses-bare-path-and-fragment.md) — the previous name-level closure; this ADR closes the class it left open.
- [ADR 0040](0040-gdpr-privacy-audit.md) — the `pii()` registry that `SENSITIVE_KEYS` mirrors.
- [ADR 1009](1009-sentry-request-pii-scrub.md) — the api-side request scrub whose wholesale deletes this brings to the shared scrubber.
- Installed SDK bundles read for the emission sites: `@sentry/core` (`integrations/requestdata.js`, `integrations/http/server-subscription.js`, `integrations/http/get-outgoing-span-data.js`, `utils/request.js`), `@sentry/node-core` (`sdk/index.js`, `integrations/http/*`), `@sentry/browser` (`integrations/httpcontext.js`), `@sentry/nextjs`.
- `apps/api/src/sentry/init.ts` — the bespoke `beforeSend` that had already deleted both container fields.
