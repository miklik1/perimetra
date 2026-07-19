# ADR 1013 — PostHog analytics events are URL-query-scrubbed at the SDK's own `before_send`

**Status:** Accepted (2026-07-19) — **Skeleton-authored (channel-A drain of `2f83b8d`, by content; ADR re-authored, not cherry-picked); HQ-ruled, Martin ratify queued.** Extends [ADR 0021](0021-telemetry-observability-package.md) (the telemetry seam) and closes the follow-up [ADR 1011](1011-client-sentry-url-query-scrub.md) recorded as owed.

## Context

ADR 1011 closed the querystring-PII leak on the client/mobile **Sentry** envelope. It also named, explicitly, what it did not close:

> **Out of scope, recorded as owed:** `@repo/telemetry`'s scrubber is one of two client telemetry sinks — PostHog's `posthog-js` autocaptures a `$pageview` whose `$current_url` includes the query and does **not** pass through this scrubber. Closing that is a separate PostHog-config change (`@repo/telemetry/posthog-analytics`), tracked as a perimetra-owed follow-up, not this ADR.

That is this ADR. The leak is the same class ADR 1009 closed on the server and ADR 1011 closed on Sentry: an arbitrary query parameter carries PII that neither a value-shape pattern nor a `pii()`-key deny-list can recognise. A surname typed into a search box rides in `?search=Nováková`; `Nováková` matches no shape and `search` is no `pii()` column.

Three facts make PostHog a genuinely separate sink rather than a variant of the Sentry one:

1. **The adapter is not on the path.** `packages/telemetry/src/posthog-analytics.ts`'s `createPosthogAnalytics` wraps only the _explicit_ `trackEvent` / `screen` calls the app makes. `posthog-js` (pinned `^1.379.2`) autocaptures `$pageview`, `$pageleave` and `$autocapture` **internally**, attaching the full URL — query included — as `$current_url` / `$referrer`, and as `$initial_current_url` / `$initial_referrer` person properties. None of that traffic passes through the adapter, so no adapter-level scrub can reach it. An arbitrary `?search=<surname>` shipped to PostHog in the clear on every page load.

2. **The scrub cannot be the Sentry scrub.** `posthog-analytics.ts`'s `identify` ships `client.identify(user.id, { email, username })` **by design** — that payload is the point of identify. Applying `redactString`'s value-shape layer to PostHog properties would `[Filtered]` the intended payload, and perimetra's own `SENSITIVE_KEYS` superset plus the rodné-číslo shape pattern would risk false-positive redaction of PostHog's structural properties (`$device_id`, `$time`, numeric ids). The correct scrub here is **URL-query-only**, not a full key/shape walk.

3. **Two gaps in the ADR-1011 walk itself**, verified still present in perimetra's `packages/telemetry/src/scrub.ts` before this change:
   - **No `transaction`-key rule.** `scrubValue`'s key-branch chain had no `transaction` case, so a route-shaped Sentry transaction name (`GET /api/customers?search=Nováková`) fell through to generic pattern redaction, which strips nothing from a query whose value has no matchable shape.
   - **The embedded-URL strip was http(s)-only.** `EMBEDDED_URL_QUERY` matched `https?://` alone, so a `wss://` Centrifugo handshake URL or a protocol-relative `//host/path?q=` embedded in free text kept its query.

## Decision

Add a new, SDK-free `sanitizeAnalyticsProperties` (`packages/telemetry/src/analytics-scrub.ts`, exported from the package index) and wire it into `posthog.init`'s `before_send`, which runs on **every** event the SDK sends — autocaptured events included.

**The injection is DAG-driven.** `posthog.init` lives in `packages/flags/src/web.tsx` (`FlagsProvider`), and the ESLint-enforced dependency DAG forbids a `flags → telemetry` edge. So `FlagsProviderProps` gains an optional `sanitizeProperties` prop and the **app composition root** supplies it: `apps/web/app/providers.tsx` already imports from both `@repo/telemetry` and `@repo/flags/web`, making it the one place that legitimately knows both seams. This mirrors the existing identity/token injection pattern; `@repo/flags` gains a prop, not a dependency.

The scrub rules:

- **URL-bearing keys** (`$current_url`, `$referrer`, the `$initial_*` variants, `$external_click_url`, element `href` / `attr__href`) keep origin + path and drop the query, via the `stripEmbeddedUrlQueries` helper split out of `scrub.ts` so the two sinks share one URL-stripping implementation.
- **A URL-named key does not gate on URL shape.** `attr__href` means the value _is_ a URL, including bare relative forms (`/a/b?q=1`) that no shape test recognises.
- **Every other string** has only an embedded URL's query stripped — never a value-shape redaction, per the identify rationale above.
- **`$elements_chain` gets a dedicated branch.** It is attached to every `$autocapture` independently of `$elements`, and it is what PostHog's ingestion actually reads. A generic pass cannot see a relative `href` (no `://`), and an unbounded match tail on an absolute one would shred the rest of the chain. Each quoted `href` / `attr__href` is rewritten in place — _except_ when posthog's escaping makes the chain unparseable, in which case the whole property is dropped (see the divergence below).
- **`$snapshot` passes through untouched.** Session-replay batches ride the same capture path, but `$snapshot_data` is a serialized rrweb DOM. Walking it would rewrite node `href`/`src` (a `/_next/image?url=…&w=640` becomes a 400), desync `$snapshot_bytes` from the payload, and deep-copy up to ~1 MB synchronously per batch. Replay masking is rrweb's own layer (`maskAllInputs`, privacy classes) — this is the wrong seam.
- **`$set` and `$set_once`** are scrubbed alongside `properties`, since the `$initial_*` person properties land there.

And the two `scrub.ts` gap closes:

- **`scrubTransaction`** — a `transaction`-key case in the `scrubValue` walk that treats the value as a route (request line _or_ bare path) and strips its query even with no verb. A transaction name is a route identifier, never prose — which is why it can strip unconditionally where the adjacent `description` case must not (a `db.query` description's bind-placeholder `?` has to survive).
- **Widened embedded-URL matching** — `EMBEDDED_URL_QUERY` now covers `ws(s)://` as well as `http(s)://`, and a new `EMBEDDED_PROTOCOL_RELATIVE_URL_QUERY` handles `//dotted.host[:port]/path?q=`. The dotted-host guard keeps `// a comment?` or a `path//x?y` fragment from being truncated at a stray `?`; the optional `:port` is part of the authority group, without which the host group ends at the `:` and the whole match fails.
- **Both embedded passes keep the whitespace-bounded `\S*` query tail.** Upstream's carrier-sparing bound is rejected as unsafe — see the deliberate upstream divergence below.

## Deliberate divergence from skeleton `2f83b8d`

Perimetra does **not** take upstream's version of two rules. The drain's adversarial review found, and independent reproduction against the shipped source confirmed, that both leak. Perimetra ships different rules; the fix is owed upstream (see Consequences).

Both upstream rules, and three successive attempts to repair them, failed **the same way**, which is the finding worth carrying: _any rule that infers a string boundary from local context can be defeated by planting that context inside the value._ Whoever controls the URL or the href controls the bytes the heuristic reads.

**1. The query tail (`scrub.ts`).** Upstream narrowed both embedded-URL tails from `\S*` to `[^\s"'<>]*` so redaction would stop eating a JSON carrier's closing quote — a real bug it does fix. But that stops at the first quote _anywhere_, including one inside a query value, before the PII:

```
input            Failed to fetch https://api.acme.cz/search?token="abc"&surname=Novakova
perimetra HEAD   Failed to fetch https://api.acme.cz/search              (pre-drain: safe)
skeleton 2f83b8d Failed to fetch https://api.acme.cz/search"abc"&surname=Novakova   (LEAKS)
```

Nothing downstream catches it: the surviving `surname=Novakova` matches no value-shape pattern, which is precisely why the deny-by-default cut exists — and on the analytics path `scrubEntry` calls `stripEmbeddedUrlQueries` with no shape pass at all. Taking upstream's version verbatim would have made perimetra's **already-shipped** Sentry scrub worse.

Two repairs were attempted and both were broken by an adversarial pass that executed the real functions. Terminating on "a quote followed by carrier structure (`,` `}` `]` `:` `;` `>` `)`) or end-of-string" is defeated by `?tag="vip",customer=Novakova`. Narrowing that to the _first_ quote only is defeated by `?a=x":Novakova` — the planted quote simply _is_ the first one. The carrier's own closing quote is indistinguishable from a planted one by construction, so no local test separates them.

**So perimetra rejects the carrier-sparing goal outright and keeps `\S*`.** The cost is real and accepted: a URL inside a structured carrier loses the rest of the carrier, not just its query. That is an observability bug; the alternative is a GDPR bug. The orthogonal and genuinely-good halves of upstream's change — `ws(s)://` coverage, the protocol-relative pass with its dotted-host and `:port` handling, and the `transaction`-key rule — are taken unchanged.

**2. `$elements_chain` href extent (`analytics-scrub.ts`).** Upstream's `href="([^"]*)"` assumes the first `"` closes the value. `posthog-js` (verified in the installed 1.379.2 bundle) escapes a literal quote as `\"` but **never escapes a backslash** — `e.replace(/"|\\"/g, '\\"')`. The encoding is therefore **lossy**: a `\"` is genuinely ambiguous between "escaped quote mid-value" and "value ending in a literal backslash, then the real delimiter". Every parsing strategy tried leaked:

- `[^"]*` (upstream) stops at the first quote, stranding the rest of that href's value — the PII — in the chain as raw text. A contained, single-href leak.
- Honouring `\"` as an escape is **worse**: on a value ending in a literal backslash the match runs past the real delimiter and consumes the _next_ href's opening quote as its own, so that href's query is never seen. Reproduced as a byte-identical passthrough of `attr__href="/checkout?token=…"`.
- Anchoring on the chain grammar (a real closing quote is followed by `;`, end-of-string, or the next `name="`) only moves the tell: a value containing a quote followed by grammar-shaped text (`?a=1\";customer=Novakova`) strands the surname.

**So perimetra parses no escapes and detects the ambiguity instead.** It has one reliable tell: it requires a `\"` in the chain. With no `\"` anywhere, every `"` _is_ a real delimiter and `[^"]*` is exactly correct — the overwhelmingly common case, so ordinary chains keep their element detail. When a `\"` is present the chain cannot be parsed safely, so the whole property is dropped to `[Filtered]`. Losing one autocapture chain beats shipping a token.

Every leaking input above is pinned by a regression test, so neither a future drain nor a future "simplification" can reintroduce them.

Process note worth keeping: the first cut of both fixes passed the full gate _and_ a five-lens adversarial review. Two further rounds of dedicated attackers — each **executing the real functions** against constructed inputs rather than reasoning about the regexes — found a fresh bypass each time, the second one severe. For redaction code, "the tests pass" and "a reviewer read it" are both much weaker evidence than "someone tried to break it and failed".

## Consequences

- The `$current_url` leak closes at the SDK's own `before_send`, covering autocaptured events, both `href` carriers, and `$set`/`$set_once`, while `identify`'s deliberate email/username payload, PostHog's structural ids, and session replay all survive untouched.
- Both `scrub.ts` gaps close for **every** Sentry hook (breadcrumb, span, transaction) at once, because the rules are single-homed in the `scrub.ts` walk (ADR 1011's consolidation).
- DAG-clean: `@repo/flags` gains an optional prop, no new package edge. The app remains the only module that knows both seams.
- Coverage: `packages/telemetry/src/analytics-scrub.test.ts` (new), plus extensions to `packages/flags/src/web.test.tsx` (the `before_send` wiring, the null-event pass-through, the `$snapshot` pass-through) and `packages/telemetry/src/scrub.test.ts` (transaction, `ws(s)`, protocol-relative, quote-bounded tail).
- Perimetra's `SENSITIVE_KEYS` superset (ADR 0071/0082) is untouched — it sits in a region of `scrub.ts` disjoint from every hunk here.
- The five defects beyond the original two-gap scope (`$elements_chain`, `$snapshot`, the unbounded tails, the `:port` authority, the URL-named-key shape gate) were all found by adversarial review **after** the gates ran green. The lesson is recorded upstream and worth restating: a leak surface has to be enumerated against the SDK's real emitted properties, not inferred from a passing build.
- **Two pre-existing gaps found by the same attack rounds, one closed and one accepted.** Neither is a regression from this drain — both reproduce against perimetra's pre-drain `scrub.ts`.
  - **Closed:** the scheme-bearing pattern carried a `\b` anchor, which a word character glued to the scheme defeats (`requesthttp://svc/x?token=…`, trivially produced by concatenation in a log line). The protocol-relative pass could not cover for it when the host is single-label (`internal-svc` — the ordinary k8s service-name shape), because that pass requires a dotted host. With both guards missed the string passed through with **zero** redaction, token included. The anchor is dropped; losing it only ever matches more text, which is the safe direction.
  - **Accepted, tracked as owed:** the whitespace-bounded tail strands anything after a raw space _inside_ a query value (`?q=Jana Novakova` leaks the surname). Consuming past whitespace would eat the surrounding prose, and a URL's true end in free text is not knowable — the same unsolvable boundary problem as above. A well-formed URL percent-encodes the space; a hand-written or already-decoded one in a log message may not. Pinned by a test named as a known limit so it is visible rather than forgotten.
- **Owed upstream (channel A).** The two divergences above are defects in skeleton `2f83b8d` itself, not artefacts of this port — so they are live in `fullstack-skeleton` and in every project stamped from it that has drained that commit (Anyora, Primat, Booking are worth checking). Per the skeleton-sourced-bug rule the fix is pushed upstream; until it lands, perimetra's `scrub.ts` and `analytics-scrub.ts` are intentionally **ahead of** the recorded `skeleton.baseCommit`, and a future drain must not "restore" upstream's version. The reusable bug class is written up in the vault as _A redaction tail narrowed to spare its carrier under-redacts — a security regex must fail toward over-redaction_.

## Sources

- [ADR 1011](1011-client-sentry-url-query-scrub.md) — the client Sentry scrub, whose own Consequences named this follow-up as owed.
- [ADR 1009](1009-sentry-request-pii-scrub.md) — the same leak class on the server envelope.
- [ADR 0021](0021-telemetry-observability-package.md) — the telemetry/scrub seam.
- Channel-A drain of skeleton `2f83b8d`.
- `posthog-js` (`^1.379.2`) `PostHogConfig.before_send`, which supersedes the deprecated `sanitize_properties`.
