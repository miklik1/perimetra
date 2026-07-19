# ADR 1019 — The analytics array branch carries its key, `SENSITIVE_KEYS` regains its credential vocabulary, and the `net.host.ip` rule is retired

**Status:** Accepted (2026-07-19) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Discharges the array-branch leak that [ADR 1018](1018-elements-chain-quote-alternation.md) inherited, and corrects a false rationale in [ADR 1017](1017-scrub-key-lists-miss-containers-and-attribute-forms.md). Drained from skeleton `2012000` (upstream ADR 1019).

**Provenance.** Adversarial cross-repo review of the skeleton working tree against `web-native-skeleton`'s concurrent tree. Every claim below was re-reproduced here by executing this repo's real exported functions and read out of this repo's own `node_modules`.

## Context

**1. The analytics array branch discards the property key.** `scrubEntry`'s array branch passed `""` instead of the key, which disarms every key-gated branch. Invisible for an array of OBJECTS (`$elements`, where the object branch below restores real keys), which is why it survived review — but for an array of STRINGS under a URL-named key the value falls through to `stripEmbeddedUrlQueries`, which requires a `://` or a dotted `//host`. A **relative** href therefore kept its query while the byte-identical scalar was stripped:

```
sanitizeAnalyticsProperties({ href: ["/clients?search=Novakova"] })  →  unchanged   (leak)
sanitizeAnalyticsProperties({ href:  "/clients?search=Novakova"  })  →  "/clients"  (correct)
```

This sink runs **no** value-shape pass at all (`sanitizeAnalyticsProperties` is key-driven only), so nothing downstream compensates, and the Sentry walk cannot cover for it either — `URL_KEYS` deliberately excludes `href`/`$current_url`, which are this module's names.

**2. `SENSITIVE_KEYS` had lost half its purpose.** It omitted `tel`, `iban`, `bank_account`, `ssn`/`national_id`, `session_id` and `rc`. The obvious justification — "this list is the hand-mirror of the `pii()` column registry and the schema declares no such column" — does not hold: the list already carries a dozen entries that are not `pii()` columns (`authorization`, `cookie`, `password`, `secret`, `token`, `api_key`, `rodne_cislo`, …), so "not a column" was never its membership test and cannot explain the absence.

Stronger: this module's own header states the governing obligation — the scrubber exists because of "the cross-package obligation created by `@repo/validators/primitives/cz.ts` shipping a rodné-číslo validator". That same file ships `bankAccount` and `iban` a few lines away, and `phoneE164` sits in `primitives/index.ts`. Identical minting, identical obligation, discharged for one and not the others. None of these values matches any `STRING_PATTERN` (the four are Bearer, JWT, email and the rodné-číslo digit shape), so the key list is the only defence that exists for them. `bank_account` looked half-covered only by accident — the rodné-číslo pattern happens to eat a 10-digit account number and leave the bank code (`"19-[Filtered]/0800"`), a value-shape coincidence, not coverage.

This repo's exposure is broader than the skeleton's, because IBAN and bank account are ordinary form fields here: the ADR 0112 invoice module and the odběratel fields of ADR 0071/0082 mint exactly these values in real user-facing forms.

**3. `net.host.ip` was redacted on a rationale the installed bundle refutes.** ADR 1017's "Why both" paragraph: "which of the two is the REMOTE party depends on the span's direction (server span: peer is the caller; client span: host is us), and the attribute name alone does not carry the direction". `web-native-skeleton`'s registry asserted the exact negation as settled fact. Two contract artifacts, one SDK, opposite conclusions.

**4. Three of the four cookie-attribute arms were untested.** `SENSITIVE_ATTRIBUTE_KEYS` ends with `http\.(request|response)\.header\.(set_)?cookie(\..*)?`, and ADR 1017 claims "the `http.{request,response}.header.{cookie,set_cookie}` family". Pinning only the request-side arms would leave the suite green while the ADR kept promising response coverage.

## Decision

1. **The analytics array branch carries the property key**: `value.map((item) => scrubEntry(key, item))`. This matches `./scrub`'s `scrubUrlValue`, which already carries URL mode through an array. Reachability is stated narrowly: posthog-js autocapture never emits an array of strings under a URL-named key (`$current_url`/`$referrer` are scalars, `$elements` is objects), so this is not a default-path leak — it goes live the moment app code writes `trackEvent(…, { href: [...] })`. Fixed rather than deferred because the surprise is total: the identical scalar IS stripped, so an author has no signal the array form is not. Tests pin the string-array, nested-array and chain-in-array cases, plus the arrays-of-objects control.

2. **`SENSITIVE_KEYS` regains the credential/PII vocabulary**: `phone`/`phone_number`/`tel`, `iban`, `bank_account`, `ssn`/`national_id`, `session_id`, `rc`. The list is explicitly a `pii()` column mirror **plus** a generic vocabulary, and the comment now says so, so the next reader does not re-derive the false "columns only" rule and strip them back out. (`phone`, `ico`, `dic`, `address_line`, `city` and `postal_code` are also genuine `pii()` columns here — the customer odběratel fields — so they carry both obligations at once; the widening adds `phone_number` as a superset of the existing bare `phone`.) `session_id` is the weak member and is listed with open eyes: real session-cookie names (`__Host-auth_session_token`, `connect.sid`, `next-auth.session-token`) match no anchor here, which is why the `cookies` **container** rule from ADR 1017 is what actually protects the session. `rc` is the ordinary Czech abbreviation for rodné číslo and the form a hand-written field actually uses. A test pins that every new entry stays anchored, so `tel` cannot eat `telemetry_enabled` nor `session_id` eat `session_replay_url`.

   **One deliberate divergence from `web-native-skeleton`.** That repo carries a bare `^session([-_]?id)?$`; this repo takes only `session_id`. Here `session` is a Better Auth **DB table** whose `ip_address` and `user_agent` are individually registered `pii()` columns — an anchored `^session$` redacts the whole row container and hides those columns behind one `[Filtered]`, blinding the very mirror `scrub.pii-contract.test.ts` exists to guard. web-native has no `packages/db` and so no such container. The comment says "do not restore parity here", and a test pins that the container stays walkable.

   The `user_agent` member of the generated header family is widened from `http.request.header.user_agent` to `http.{request,response}.header.user_agent`: `httpHeadersToSpanAttributes` generates from whichever header bag it is given and does not special-case direction, so the narrower form was drift, not a decision.

3. **`net.host.ip` is removed from `SENSITIVE_ATTRIBUTE_KEYS`, and the rationale is corrected rather than merely re-worded.** Across this repo's whole dependency tree the attribute has exactly two writers and both are SERVER spans assigning `localAddress`: `@sentry/core` `integrations/http/server-subscription.js` (`"net.host.ip": localAddress`, in an object literal that also hardcodes `"otel.kind": "SERVER"`) and `@sentry/node-core` `httpServerSpansIntegration.js` (`newAttributes[SEMATTRS_NET_HOST_IP] = localAddress` — the **constant** form, invisible to a literal-string grep; the claim must be checked over both spellings). The client-span emitter, `get-outgoing-span-data.js`, writes `net.peer.name` / `net.peer.ip` / `net.peer.port` and never `net.host.*`.

   So `net.host.*` **is** the local side at every emission site, and per OTel semconv generally. Span direction changes whether the PEER is an end user or an upstream service — which is exactly why `net.peer.ip` stays redacted — never which side is local. The retired rationale was additionally self-refuting (both its own parentheticals resolve to "host is us") and internally inconsistent (it never listed `net.host.port`, though the argument would apply to the port identically). `net.host.ip` is the server's own address, the same category as `server_name`, which `STRUCTURAL_KEYS` already exempts. A test pins the retention alongside `net.peer.ip` still being filtered.

   **This is a policy change, not just a comment fix.** Keeping the rule and rewriting the reason was the tempting minimal edit, but once the premise is gone the trade it priced does not exist: there is no ambiguity to over-redact against, and the sibling `net.host.name` / `net.host.port` disclose the same topology and were never listed.

4. **All four cookie-attribute arms are pinned** — `(request|response)` × `(set_)?` — so narrowing the regex cannot leave the suite green while ADR 1017 still promises the whole family.

## Consequences

- **The analytics sink is now key-correct through arrays at every depth**, matching the Sentry sink's long-standing behaviour. The two sinks no longer disagree about what a URL-named key means.
- **Accepted cost of the vocabulary additions**: an application field legitimately named `phone` or `iban` is redacted wholesale in telemetry. That is the fail-safe direction this module is explicitly built around, and every entry is anchored so substring collateral is impossible.
- **`net.host.ip` returns to traces.** Slightly better trace debuggability, no privacy change — it was never the user's address.
- **A green gate proved nothing about the cross-repo split.** Both skeletons' suites were green while encoding opposite policies for `net.host.ip`, because no test crosses the repo boundary and each pinned its own behaviour. Cross-repo parity is not a property any in-repo gate can observe; it has to be reviewed deliberately, in **both** directions.
- **Scope of the claim.** These rules cover the fields named above on the envelope paths `sentry-options.ts` wires. They are not a guarantee that every string in an event is reached: the defence remains a deny-list of key names plus a deny-list of value shapes, and a shapeless value under an unlisted key still passes.
- **Not covered by any per-commit gate.** The upstream text explains this by an `if: github.event_name != 'push'` fence on the CI `integration` job; that mechanism is the **skeleton's** and is false here. This repo's `.github/workflows/ci.yml` carries **no `push:` trigger at all** (only `pull_request`, `schedule` and `workflow_dispatch`), which is the same deliberate Actions-minute tradeoff reached a different way — and it makes the conclusion stronger, not weaker: no CI job whatsoever runs on a commit to `main`, so the local pre-push gate is the real ship-bar. `apps/api/test/privacy.itest.ts` additionally matches only the integration config's `test/**/*.itest.ts` glob. The `waitForEraseAudit` race fix landing in this same commit is therefore verified by a local Docker run, not by CI.

## Sources

- [ADR 1018](1018-elements-chain-quote-alternation.md) — the sibling chain fix landing in the same commit; the array-branch leak discharged here was booked against it upstream.
- [ADR 1017](1017-scrub-key-lists-miss-containers-and-attribute-forms.md) — the `net.host.ip` rationale retired here, and the cookie-family claim now fully pinned.
- [ADR 0040](0040-gdpr-privacy-audit.md) — the `pii()` column mirror that a bare `^session$` entry would have blinded.
- `@repo/validators/primitives/cz.ts` and `primitives/index.ts` — the `bankAccount` / `iban` / `phoneE164` validators whose existence creates the same obligation as the rodné-číslo one.
- `@sentry/core`: `integrations/http/server-subscription.js`, `integrations/http/get-outgoing-span-data.js`. `@sentry/node-core`: `integrations/http/httpServerSpansIntegration.js`.
- `web-native-skeleton` ADR 1011/1012 — the originating cross-repo review.
