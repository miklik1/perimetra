/**
 * PII scrubber (ADR 0021, extended by ADR 1011): a pure, platform-neutral pass
 * the Sentry bindings wire into `beforeSend` / `beforeBreadcrumb` /
 * `beforeSendTransaction` / `beforeSendSpan`, so tokens, emails, Czech rodná
 * čísla and arbitrary querystring PII never leave the device — the
 * cross-package obligation created by `@repo/validators/primitives/cz.ts`
 * shipping a rodné-číslo validator (a validated-but-REJECTED candidate value
 * otherwise rides along in form-state context or error messages).
 *
 * Deliberately NOT the validator's logic, and no `telemetry → validators`
 * import (the DAG forbids it): validation is strict input checking (anchored,
 * mod-11 checksum); redaction is fail-safe DETECTION in arbitrary text. The
 * RČ pattern below redacts anything rodné-číslo-SHAPED — including 9–10 digit
 * runs that would fail the checksum — because over-redacting an innocent
 * numeric id is acceptable and a leaked RČ is not.
 *
 * Two layers (ADR 1011):
 *   1. Pattern redaction — a DENY-LIST of value SHAPES (email/JWT/Bearer/RČ)
 *      plus a wholesale drop of values under a PII key NAME.
 *   2. URL query stripping — a DENY-BY-DEFAULT pass: an arbitrary
 *      `?search=<surname>` param has no value shape, so pattern redaction alone
 *      leaks it. The query is dropped (path kept) both by field NAME (`url`,
 *      `url.full`, `referer`, navigation `to`/`from`, span `description`, …) AND
 *      by VALUE — any absolute `http(s)://…?query` embedded in free text (an
 *      error message, a breadcrumb string) has its query cut in `redactString`,
 *      so the leak is closed even where no URL-named key reaches it. The server
 *      drops the whole querystring fail-closed (ADR 0040); this is the
 *      client/mobile mirror, keeping the path for trace debuggability.
 */

/** The single redaction marker, shared with the analytics sink (`./analytics-scrub`). */
export const REDACTED = "[Filtered]";

// Order matters: Bearer/JWT first so an email-less token line doesn't get
// partially rewritten by a later pattern.
//
// EVERY UNBOUNDED QUANTIFIER THAT CAN SCAN A CAPTURED STRING CARRIES AN
// EXPLICIT UPPER BOUND (ADR 1043). This module runs on `beforeSend` /
// `beforeBreadcrumb` — synchronously, on the caller's thread, over strings an
// attacker can influence (an error message, a request body, a breadcrumb) — so
// a quadratic pattern here is a reachable DoS and not a style question. It was
// one: measured on this box against a 128 KB string, the e-mail pattern alone
// blocked for 9.0 s and the JWT pattern for 7.7 s. The bounds below are the
// only reason the whole pass is now linear.
//
// The bounds are STANDARDS-DERIVED, never guessed, so what falls outside them
// is stateable: RFC 5321 caps an e-mail local part at 64 octets, the longest
// IANA TLD is 24 characters, and a DNS name has at most 127 labels. A string
// outside those is not a deliverable address, and the cost of the bound is that
// the redaction becomes NARROWER rather than absent — a 70-character local part
// still redacts, just from character 65 onward. Pinned by `./scrub.test`, which
// asserts both the coverage and the timing.
// Exported for `./scrub.test`, which asserts the bound property structurally
// (no open-ended `{n,}` survives here) rather than only by timing — a timing
// assertion alone tells you a machine was fast, not that the pattern is safe.
// The sibling skeleton exports the same list from its `@repo/utils` registry.
export const STRING_PATTERNS: RegExp[] = [
  // Authorization header values: "Bearer <anything token-ish>".
  // Deliberately NOT bounded: the literal `Bearer\s+` prefix anchors the match,
  // so there is one start position per occurrence of that word and the trailing
  // `[\w\-.~+/]+=*` has no ambiguity to backtrack through (`=` is not in the
  // class). Measured flat at 0.6 ms on a 128 KB input.
  /\bBearer\s+[\w\-.~+/]+=*/gi,
  // Bare JWTs (three base64url segments). Bounded per segment. The FIRST bound
  // is the one that matters for cost — a string that is one long `[\w-]` run
  // with no dot backtracks through the whole first segment at every word
  // boundary — and 512 is chosen for headroom over a real header (a b64url
  // `{"alg":"RS256","typ":"JWT"}` is 36 chars; ~200 with `kid`/`x5t`). The
  // payload and signature bounds cost nothing measurable and are set generously:
  // 4096 covers a large claim set, 1024 covers an RS512 signature (683 chars).
  // Verified to still match HS256, RS256, RS512 and a 4 KB-payload token.
  /\b[\w-]{8,512}\.[\w-]{8,4096}\.[\w-]{4,1024}\b/g,
  // Emails. The domain is DECOMPOSED into labels rather than written as one
  // `[\w.-]+` run, and that is a coverage decision, not a cosmetic one: the flat
  // form has to be capped at the 255-octet domain limit to stay linear, which
  // silently stops matching a long single-label domain, while the decomposed
  // form is linear WITHOUT that cap because `[\w-]` cannot match the `.` that
  // separates the labels — so the partition is deterministic and there is
  // nothing to backtrack across. Same worst case (18.7 ms vs 18.1 ms at 128 KB),
  // strictly more coverage.
  /[\w.%+-]{1,64}@(?:[\w-]+\.){1,64}[A-Za-z]{2,24}/g,
  // Rodné číslo SHAPE: YYMMDD, optional "/", 3–4 digits — also catches the
  // slashless 9–10 digit form (see the fail-safe note above). Already bounded;
  // measured flat at 0.3 ms on a 128 KB digit run.
  /\b\d{6}\s*\/?\s*\d{3,4}\b/g,
];

// Fast-path guard: one alternation over the patterns above, tested before the
// shape `.replace` passes run. Breadcrumbs are the SDK's highest-frequency hook
// and the overwhelming majority of their strings carry no PII (and no `://`) —
// those cost a single `.includes` + `.test()` instead of four allocating
// `.replace` passes. Keep in sync with STRING_PATTERNS (the test below asserts
// the equivalence).
const ANY_PATTERN = new RegExp(STRING_PATTERNS.map((p) => `(?:${p.source})`).join("|"), "i");

// A SCHEME-BEARING URL embedded anywhere in a string: keep everything up to the
// path, drop the `?query`/`#fragment`. Requires `://` so a bare "1/2?x" in free
// text is never mistaken for a URL (the ambiguous relative case is left to the
// field-name rules, which know the value IS a URL). Covers http(s) AND ws(s) —
// a `wss://…?token=` handshake URL rides in realtime breadcrumbs/errors and
// leaks its query exactly like an http one. Replacement keeps group 1.
//
// The query tail is bounded by WHITESPACE ONLY. An earlier version bounded it at
// a quote/angle bracket too (`[^\s"'<>]*`), to stop redaction eating the closing
// delimiter of a URL embedded in STRUCTURED free text — a JSON-ish breadcrumb
// (`{"url":"https://a/b?c=1","user":"x"}`). That spares the carrier but
// UNDER-REDACTS, which is the worse failure: it stops at the first quote
// *anywhere*, including one inside a query value, so
// `?token="abc"&surname=Novakova` keeps the surname. Nothing downstream catches
// it — a bare surname matches no value-shape pattern, which is exactly why this
// deny-by-default cut exists, and the analytics sink runs it with no shape pass
// at all.
//
// Two repairs were tried and an adversarial pass broke both: terminating on "a
// quote followed by carrier structure" falls to `?tag="vip",customer=Novakova`,
// and narrowing that to the FIRST quote falls to `?a=x":Novakova`, because the
// planted quote simply IS the first one. The carrier's own closing quote is
// indistinguishable from a planted one by construction, so no local test
// separates them — any rule that infers a boundary from local context can be
// defeated by planting that context inside the value.
//
// So the carrier-sparing goal is abandoned. The accepted cost: a URL inside a
// structured carrier loses the rest of the carrier, not just its query. That is
// an OBSERVABILITY bug; the alternative is a GDPR one. A scrubber must fail
// toward over-redaction.
//
// NO `\b` before the scheme, either. A word character glued to the scheme
// (`requesthttp://svc/x?token=…`, easily produced by concatenation in a log line)
// defeats a word-boundary anchor, and the protocol-relative pass below cannot
// cover for it when the host is single-label (`internal-svc`, the ordinary k8s
// service-name shape) because that pass requires a dotted host. With both guards
// missed the string passed through with ZERO redaction. Dropping the anchor only
// ever matches MORE text — the safe direction; the `://` requirement still stops
// a bare "1/2?x" being mistaken for a URL.
//
// THE PATH RUN IS BOUNDED, and unlike the value-shape patterns above this one
// could NOT be fixed by removing ambiguity (ADR 1043). `[^\s?#]*` excludes `?`
// and `#`, so its backtracking is already provably useless — an atomic-group
// rewrite was measured and only halved the cost, because the expense is the
// GREEDY FORWARD SCAN, not the backtrack: on `"https://".repeat(16384)` every
// one of the 16 384 `https://` occurrences is a match attempt that scans to the
// end of the string. 1.5 s on a 128 KB input, from any captured string, with no
// `@` and no token needed. The bound makes each attempt O(2048) instead of
// O(remaining).
//
// The cost of the bound: a URL whose origin+path exceeds 2048 characters keeps
// its query here. That is acceptable ONLY because this pass is explicitly the
// best-effort half — the policy above says so in as many words. Anything a KEY
// identifies as URL-bearing goes through `safeUrlOrRedact`, which is the URL
// PARSER and has no regex and no length limit at all. This bound narrows the
// free-text fallback, never the guarantee.
const EMBEDDED_URL_QUERY = /((?:https?|wss?):\/\/[^\s?#]{0,2048})[?#]\S*/gi;

// A PROTOCOL-RELATIVE URL ("//cdn.host/path?q=…") embedded in free text: no
// scheme to anchor on, so it is guarded by a DOTTED host (a real domain) — this
// keeps a bare "// a comment?" or a "src/a//b?c" path fragment from being
// truncated at a stray "?". An optional `:port` is part of the authority
// ("//api.stg.example.com:8443/x?q=…"): without it the host group ends at the
// ":" and the whole match fails, leaving the query intact. Keeps `//host/path`,
// drops the query/fragment; same whitespace-bounded tail as the scheme pass.
//
// Bounded on the same argument and by the same measurement as the pass above:
// `"//a.b/".repeat(21845)` cost 2.2 s, because each `//` is a match attempt
// whose optional path run scans to the end. The label bounds are the DNS limit
// (63 octets); the port is at most 5 digits; the path bound is the one that
// carries the cost, exactly as above.
const EMBEDDED_PROTOCOL_RELATIVE_URL_QUERY =
  /(\/\/[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+(?::\d{1,5})?(?:\/[^\s?#]{0,2048})?)[?#]\S*/gi;

// Keys whose VALUES are redacted wholesale, wherever they appear in an event.
// The PII registry (packages/db/src/pii.ts, ADR 0040) "drives the Sentry
// beforeSend scrubber", so every pii()-registered column NAME is mirrored here:
// name/email/image (user), ip_address/user_agent (session), identifier
// (verification). Add the bare column name when a new pii() column lands — the
// registry is the source of truth, this list is the telemetry-sink mirror.
// `scrub.pii-contract.test.ts` guards the mirror against drift: telemetry can't
// import @repo/db (extension-less for Metro + the DAG forbids the edge), so the
// test reads the schema SOURCE and asserts the scrubber redacts every pii()
// column name rather than importing the registry.
//
// `cookies` (PLURAL) is a CONTAINER, not a scalar, and it is here for a reason
// the singular entry does not cover. Sentry's `requestDataIntegration` — a
// DEFAULT integration — sets `event.request.cookies` to the PARSED cookie jar
// (`parseCookie(headers.cookie)`) whenever `include.cookies` is truthy, and the
// default with `sendDefaultPii: false` is an OBJECT (`{deny: […]}`), i.e.
// `!== false`, so it is truthy. Unlike the SPAN path, the EVENT path applies no
// filtering of its own; and it runs in `processEvent`, so this is the ERROR
// path — `tracesSampleRate: 0` is no protection.
//
// The container must be dropped WHOLESALE rather than left to the walk, because
// a cookie NAME is not drawn from any vocabulary this list can enumerate. This
// skeleton's own production session cookie is `__Host-auth_session_token`
// (packages/auth/src/index.ts), which matches neither `token` nor
// `access[-_]?token` nor `refresh[-_]?token` — all anchored — and whose value
// (two dot-separated segments) matches no value SHAPE either, since the JWT
// pattern needs three. So the walk descended into the jar, found nothing it
// recognised, and shipped an httpOnly session token in the clear next to the
// `headers.cookie` copy of the SAME secret that this list redacts one key away.
// Anchoring is what keeps `cookie` from eating `cookiePreferences`; the cost is
// that it cannot see a plural, and every plural container has to be named.
//
// This list is a `pii()` column mirror PLUS a generic credential/PII vocabulary,
// and the second half is not optional (ADR 1019). `phone`/`tel`, `iban`,
// `bank_account`, `ssn`/`national_id` and `session`/`session_id` are not columns
// in this schema, but neither are `authorization`, `cookie`, `password`,
// `secret`, `token`, `api_key` or `rodne_cislo` — "it isn't a pii() column" was
// never this list's membership test, so it cannot explain their absence.
//
// The obligation is this module's own, stated in its header: the scrubber exists
// because `@repo/validators/primitives/cz.ts` ships a rodné-číslo validator, so a
// validated-but-REJECTED candidate rides along in form state. That same file
// ships `bankAccount` (cz.ts:51) and `iban` (cz.ts:75) twenty-five lines away,
// and `phoneE164` sits in primitives/index.ts:21 — identical minting, identical
// obligation, discharged for one and not the others. None of these values has a
// shape any STRING_PATTERN catches (the four are Bearer, JWT, email and the
// rodné-číslo digit shape), so the KEY list is the only defence that exists for
// them. `bank_account` looked half-covered only by accident: the rodné-číslo
// pattern happens to eat a 10-digit account number and leave the bank code
// ("19-[Filtered]/0800"), which is a value-shape coincidence, not coverage.
//
// The financial/national-id members carry the weight, in a Czech-market skeleton
// where IBAN and bank account are ordinary form fields. `session_id` is the weak
// one and is listed with open eyes: real session-cookie names
// (`__Host-auth_session_token`, `connect.sid`, `next-auth.session-token`) match
// no anchor here, which is exactly why the `cookies` CONTAINER above is the rule
// that actually protects the session. `session_id` only catches a hand-rolled
// `{ session_id: … }` context field.
//
// DELIBERATE ASYMMETRY with `web-native-skeleton`, which carries a bare
// `^session([-_]?id)?$`: here `session` is a real DB TABLE (Better Auth), and its
// members `ip_address` / `user_agent` are individually registered `pii()`
// columns. An anchored `^session$` would redact the whole row container and hide
// those columns behind one `[Filtered]`, blinding the very column mirror
// `scrub.pii-contract.test.ts` exists to guard — a worse outcome than the
// per-column redaction already in force. web-native has no `packages/db` and so
// no `session` container to collide with, which is why the bare name is safe
// there and not here. Do NOT "restore parity" by adding `^session$` to this list
// — the pii-contract test will fail, and that failure is the point (ADR 1019).
//
// `rc` is the ordinary Czech abbreviation for rodné číslo and is the form a
// hand-written form field or context bag actually uses; web-native has carried
// it since its ADR 1011. Anchored, so it cannot touch `rcVersion` or any `rc`
// substring — a release-candidate field would have to be named exactly `rc`,
// and over-redacting that is the cheap side of the trade.
//
// Three entries here have NO web-native counterpart, and THAT asymmetry is
// correct: `name`, `image` and `identifier` are `pii()` COLUMNS of this repo's
// Better Auth schema (`user.name`, `user.image`, `verification.identifier`),
// mirrored under the ADR 0040 contract. web-native has no `packages/db`, so it
// has no such columns and nothing to mirror. Do not port them there.
//
// PERIMETRA SUPERSET — additive, and NOT owed upstream. Six further entries
// exist here and in no skeleton lineage, for exactly the reason `name`/`image`/
// `identifier` exist in the skeleton and not in web-native: they are `pii()`
// COLUMNS of THIS repo's schema, so the ADR 0040 mirror obliges them, and
// `scrub.pii-contract.test.ts` reads the registry off disk and would red
// without them. `recipient[-_]?email` (document delivery, ADR 0129),
// `ico`/`dic` (the odběratel's identifiers — a Czech IČO/DIČ identifies a legal
// person and, for an OSVČ, a natural one), and `address[-_]?line`/`city`/
// `postal[-_]?code` (the buyer's postal address on a legal document). A drain
// that takes the skeleton's line verbatim silently drops all six and the
// contract test is what catches it.
const SENSITIVE_KEYS =
  /^(authorization|cookie|cookies|set-cookie|password|secret|token|access[-_]?token|refresh[-_]?token|api[-_]?key|email|recipient[-_]?email|rodne[-_]?cislo|birth[-_]?number|rc|phone([-_]?number)?|tel|iban|bank[-_]?account|ssn|national[-_]?id|session[-_]?id|name|image|ip[-_]?address|user[-_]?agent|identifier|ico|dic|address[-_]?line|city|postal[-_]?code)$/i;

// The SDK-ATTRIBUTE forms of concepts `SENSITIVE_KEYS` already owns. Kept
// SEPARATE from that list deliberately: `SENSITIVE_KEYS` is the hand-mirror of
// the `pii()` column registry and `scrub.pii-contract.test.ts` guards it against
// registry drift, so it must stay a list of bare COLUMN names. These are
// telemetry-vendor attribute names, a different source of truth (the installed
// SDK bundles), and mixing them would make the mirror unreadable.
//
// Why a bare-name list cannot reach them: `SENSITIVE_KEYS` is anchored, so
// `ip[-_]?address` cannot match `http.client_ip` or `net.peer.ip`, and
// `user[-_]?agent` cannot match `http.user_agent` or `user_agent.original`. Yet
// these are written as PLAIN LITERALS in the same `startSpan` attributes bag as
// `http.target` (`@sentry/core` integrations/http/server-subscription.js, and
// verbatim again in `@sentry/node-core` httpServerSpansIntegration.js) — the
// very literal the `http.target` fix of ADR 1016 was read out of. None is gated
// on `sendDefaultPii`; `http.client_ip` is `headers["x-forwarded-for"]` and
// `net.peer.ip` is the socket's remote address. `spanToTransactionTraceContext`
// spreads the whole attribute bag onto `contexts.trace.data`, so they reach
// `beforeSendTransaction` by exactly the route ADR 1016 documents.
//
// `net.peer.ip` is redacted; `net.host.ip` / `net.host.port` are NOT, and that
// asymmetry is settled by the emitters rather than by preference (ADR 1019,
// retiring a rule this list previously carried).
//
// The retired rationale claimed the attribute name does not carry the direction
// — "server span: peer is the caller; client span: host is us", so no local test
// separates the server's own address from the caller's. Reading the installed
// bundle refutes it. Across the whole dependency tree `net.host.ip` has exactly
// two writers and both are SERVER spans assigning `localAddress`: `@sentry/core`
// integrations/http/server-subscription.js:190 (`"net.host.ip": localAddress`,
// in an object literal that also hardcodes `"otel.kind": "SERVER"`) and
// `@sentry/node-core` httpServerSpansIntegration.js:216
// (`newAttributes[SEMATTRS_NET_HOST_IP] = localAddress` — the CONSTANT form, so
// a literal-string grep alone does not find it; the claim must be checked over
// both spellings). The client-span emitter,
// integrations/http/get-outgoing-span-data.js, writes `net.peer.name` /
// `net.peer.ip` / `net.peer.port` and never `net.host.*` at all.
//
// So `net.host.*` IS the local side at every emission site, and per OTel semconv
// generally. Span direction changes whether the PEER is an end user or an
// upstream service — which is exactly why `net.peer.ip` stays on this list — never
// which side is local. The old rule was also internally inconsistent with itself:
// it never listed `net.host.port`, though the ambiguity argument, if sound, would
// have applied to the port identically. `net.host.ip` is the server's own address,
// the same category as `server_name`, which `STRUCTURAL_KEYS` already exempts.
// `web-native-skeleton`'s registry always read it this way; both skeletons now
// agree. Do not "restore" the rule in a future drain.
//
// `http.request.body.data` is the SPAN twin of `event.request.data` and is here
// for the same reason the latter is in `REQUEST_SCOPED_SENSITIVE_KEYS` below:
// `@sentry/core` integrations/requestdata.js serialises the raw request body
// straight onto the span. `http.request.header.cookie…` covers the cookie-jar
// attribute family — Sentry filters those per-cookie-name against its own deny
// snippets, but that is ITS list, not ours, so the whole family is dropped here
// rather than trusted. It is a PREFIX rule, matching both the bare header
// attribute and its `.<cookie_name>` children. All four arms of that family —
// (request|response) x (set_)? — are pinned by tests, so narrowing the regex
// cannot leave the suite green while ADR 1017 still promises the whole family.
//
// The `user_agent` member takes the same `(request|response)` shape, matching
// web-native's registry. `httpHeadersToSpanAttributes` generates
// `http.<request|response>.header.<name>` from whichever header bag it is given
// and does not special-case direction, so scoping our rule to `request` alone
// was drift rather than a decision — and the response side costs nothing to
// cover.
//
// Sentry's own `PII_HEADER_SNIPPETS` (`forwarded`, `-ip`, `remote-`, `via`,
// `-user`) already treats the `x-forwarded-for` HEADER as PII — but applies that
// deny-list only to header/cookie/query attributes, never to the plain literals
// above. The SDK therefore filters `http.request.header.x-forwarded-for` while
// letting the identical value through as `http.client_ip`.
const SENSITIVE_ATTRIBUTE_KEYS =
  /^(http\.client_ip|net\.peer\.ip|client\.address|http\.user_agent|user_agent\.original|http\.(request|response)\.header\.user_agent|http\.request\.body\.data|http\.(request|response)\.header\.(set_)?cookie(\..*)?)$/i;

/** A key is sensitive if it is a `pii()` column name OR an SDK attribute form of one. */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.test(key) || SENSITIVE_ATTRIBUTE_KEYS.test(key);
}

// Keys that are sensitive ONLY as a direct child of `request` — i.e. only when
// the walk can see that the parent container is Sentry's request interface.
//
// `data` there is the raw, UNPARSED request BODY: `include.data` is hardcoded
// `true` in `requestDataIntegration` ("Always attach body data that's already on
// the scope"), and `httpServerIntegration` captures up to
// `maxRequestBodySize: "medium"` (10KB) by DEFAULT — neither is gated on
// `sendDefaultPii`, and `@sentry/nextjs`'s `disableIncomingRequestSpans` gates
// only the span side, so the Next.js server runtime captures bodies too. The
// value is a STRING, so the key walk cannot reach inside it and only
// `redactString` runs; an ordinary form post (`surname=Nováková&note=…`) carries
// no Bearer/JWT/email/rodné-číslo SHAPE, so nothing fires and the body ships
// verbatim. `apps/api` already independently decided this field must go, and
// deletes it wholesale in its own `beforeSend`; the shared scrubber that
// `apps/web` depends on did not, which is precisely the one-binding-hardened
// asymmetry `sentry-options.ts` warns about a level up.
//
// It is scoped to `request` rather than added to `SENSITIVE_KEYS` because `data`
// is one of the most load-bearing key names in a Sentry envelope: `spans[].data`
// and `contexts.trace.data` are the attribute bags every URL rule in this module
// operates on, and breadcrumbs carry `data` too. A global `data` rule would
// blind the scrubber's own `http.target` / `url.query` / fragment coverage by
// redacting the bag before the walk could reach the keys inside it — trading a
// leak for a bigger blind spot.
const REQUEST_SCOPED_SENSITIVE_KEYS = /^data$/i;
const REQUEST_KEY = /^request$/i;

// The ARRAY key whose elements are stack frames — `exception.values[].stacktrace
// .frames[]`, `threads.values[].stacktrace.frames[]` and the legacy top-level
// `stacktrace.frames[]` all spell it the same way. It arms the source-location
// allow-SHAPE below (ADR 1044).
const FRAMES_KEY = /^frames$/i;

// SDK/build metadata that is never user input: stack-frame locations, module
// and symbol names, release/build identifiers. Exempt from string redaction so
// a purely-numeric chunk filename or dotted module name can't be rewritten to
// "[Filtered]" (which would break source-map resolution and issue grouping).
// SENSITIVE_KEYS is checked first and wins on any overlap.
const STRUCTURAL_KEYS =
  /^(module|function|event_id|release|dist|environment|server_name|platform)$/;

// `filename` and `abs_path` USED to sit in the exempt set above, and that was a
// leak (ADR 1031). In a BROWSER stack frame those two fields are the script's
// URL — and for an error thrown from an inline or eval'd script, the script's
// URL is `location.href`, i.e. the current page WITH its querystring. So a single
// JS error on `/clients?search=Novakova&rc=…` shipped the search term in every
// frame, on the ERROR path, at the default `tracesSampleRate: 0`. The exemption
// also disabled the value-shape pass there, so a rodné číslo in the same string
// survived twice over. See `reduceSourceLocation` for why the replacement is
// narrower than "run the primitive on these keys".
//
// AND IT IS NOW AN ALLOW-SHAPE, NOT A KEY NAME (ADR 1044). The pattern alone is
// a claim about what a key CALLED `filename` cannot contain, which is the
// fail-open spelling this lineage keeps being punished for — and it was matched
// ANYWHERE in an event, at any depth. `filename` is not a reserved word in a
// Sentry envelope: it is the natural key for an upload field, so a form post
// `{filename: "novakova-8001011234.pdf"}` under `extra`, `contexts` or a
// breadcrumb's `data` bag had ALL redaction disabled on it — no value-shape
// pass, and `reduceSourceLocation` returns a relative value byte-identical, so
// the rodné číslo in that filename shipped in the clear.
//
// The exemption's justification was only ever about a STACK FRAME, so the rule
// is now scoped to where a frame actually lives: an element of a `frames` array
// (`exception.values[].stacktrace.frames[]`, `threads.values[].stacktrace
// .frames[]`, and the legacy top-level `stacktrace.frames[]`). Everywhere else
// `filename` / `abs_path` are ordinary strings and get the full walk. The
// arming is structural — the walk carries "this object came out of a `frames`
// array" — never a guess about the object's contents.
const SOURCE_LOCATION_KEYS = /^(filename|abs_path)$/;

// ── Deny-by-default URL query stripping (ADR 1011) ──────────────────────────
// Field NAMES whose value is ALWAYS a URL → unconditionally keep scheme://host/
// path, drop ?query and #fragment. `url` (fetch/xhr breadcrumb data + event
// request.url, reached by the walk), `url.full`/`http.url` (span data),
// `referer`/`referrer` (event request.headers, set by the default browser
// httpContextIntegration = the full referring URL with query) and its span
// attribute form `http.request.header.referer`.
//
// `http.target` is the one that bites hardest, and it is NOT optional. Unlike
// every other key here its value is path+query (`/clients?search=Nováková`),
// NOT an absolute URL — so it slips past every other defence in this module.
// SENSITIVE_KEYS is anchored and has no `target`; QUERY_ONLY_KEYS and
// STRUCTURAL_KEYS do not match it; so it fell to the default `scrubValue`
// branch, whose `stripEmbeddedUrlQueries` requires either a `://` or a dotted
// `//host` — a bare path has neither, so BOTH embedded-URL passes are a no-op
// and the querystring survived verbatim.
//
// The attribute is not exotic: this skeleton's `apps/web` is a Next.js app, and
// Next.js sets `http.target` unconditionally on the `BaseServer.handleRequest`
// root span, which is on `NextVanillaSpanAllowlist` and therefore ships without
// `NEXT_OTEL_VERBOSE`. Sentry's own `httpServerSpansIntegration` sets it too.
// Neither is gated on `sendDefaultPii`. Sentry reads the value only to NAME the
// span (against a stripped copy) and never deletes the attribute, so the raw
// value reaches `beforeSendTransaction` via the OTel bridge, which maps span
// attributes straight onto `contexts.trace.data` and `spans[].data`. Exposure
// therefore required `tracesSampleRate > 0`; error events were never affected,
// because `spanToTraceContext` carries only trace/span/parent ids and no `data`.
// Routing the key through `scrubUrlValue` keeps the path (route debuggability)
// and drops the query, exactly like the absolute forms above. The mobile
// binding shares this scrubber but does not set `http.target`, so this rule is
// a server-tracing fix, not a universal one.
const URL_KEYS =
  /^(url|url\.full|http\.url|http\.target|referer|referrer|http\.request\.header\.referer)$/i;

// Ambiguous PATH fields: a navigation breadcrumb's `to`/`from` ARE same-origin
// paths that can carry ?search=, but `to`/`from` are also generic key names for
// free text (confirmation copy, chat, form labels). Strip the query ONLY when
// the value is actually URL/path-shaped, so a "Cancel? yes" is never truncated.
const PATH_KEYS = /^(to|from)$/i;
// Whether a value is URL/path-SHAPED — the gate that decides whether an
// ambiguous field (`to`/`from`, a transaction name) is routed through the URL
// primitive at all.
//
// IT MUST NOT RESTATE A SCHEME VOCABULARY (ADR 1031). It used to be
// `/^(?:https?:)?\/\/|^\//`, which knew only http/https — while `SAFE_SCHEMES`
// below holds seven. The three native-build schemes added ON PROVENANCE
// (`capacitor:`, `ionic:`, `file:`) were therefore invisible to every gate that
// decides whether to CALL the primitive, so
// `capacitor://localhost/detail?surname=Novakova` came back byte-identical from
// `scrubTransaction`, `scrubDescription` and the `to`/`from` branch — even though
// the primitive itself reduces it correctly. That is ADR 1030's own stated
// failure mode ("a rule can never be closed at one sink and missed at another")
// reproduced BY the repair: the allow-list grew and its callers did not.
//
// So the gate now asks the parser, exactly like the primitive does, and the two
// can no longer disagree. Deciding what is SAFE stays the primitive's job — this
// only decides what gets asked.
const URL_SHAPED = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

// Field NAMES whose value is a BARE query string (no path to keep) → drop the
// whole value. `url.query`/`http.query` (span data), `query_string` (event
// request.query_string), `search` (a raw search-param bag — the typed search
// term, precisely the ?search=<surname> leak class).
//
// `url.fragment`/`http.fragment` are the FRAGMENT twins, written by the SDK on
// the source line adjacent to `http.query`: browser xhr/fetch spans
// (`@sentry/browser` tracing/request.js and `@sentry/core` fetch.js),
// outgoing-request breadcrumbs (`add-outgoing-request-breadcrumb.js`), and the
// OTel bridge (`@sentry/opentelemetry` resource-*.js). Do NOT reason that the
// twins ride together and so a covered key always shields its sibling — the two
// writes are INDEPENDENTLY guarded on `parsedUrl.search` and `parsedUrl.hash`,
// so a URL with a fragment and no querystring (`/path#email=jan@example.cz`)
// emits `http.fragment` with no `http.query` beside it at all.
//
// A bare fragment value has no scheme, so `stripEmbeddedUrlQueries` never fires
// and `safeUrlOrRedact` is never reached; and an arbitrary `#…` param has no value
// shape for the pattern pass to catch, which is the whole rationale for
// deny-by-default. Covering the query key but not its fragment sibling also
// contradicted this module's own policy — `safeUrlOrRedact` never reads `search`
// or `hash` at all, i.e. the module already treats a fragment as unsafe
// everywhere it can see one.
const QUERY_ONLY_KEYS =
  /^(url\.query|http\.query|url\.fragment|http\.fragment|query_string|search)$/i;

// A span `description` that is an HTTP request line ("GET https://…?q=…",
// "POST /path?x=1"). Three guards make this fire ONLY on a genuine request line:
//   1. the verb must be followed by a URL/path token (`http(s)://` or a leading
//      `/`), NOT just any word — `DELETE` is also SQL, and a db.query
//      description ("DELETE FROM users WHERE id = ?") must not be truncated at
//      its bind-placeholder "?";
//   2. the whole string must BE the request line (anchored `$`, no spaces after
//      the URL token) — a Sentry span/trace description is exactly "VERB url",
//      whereas a free-text field named "description" ("POST /api/checkout?x=1
//      returns 500 every time") carries trailing prose and must be left intact
//      rather than silently truncated at its "?".
// Pattern redaction still runs on every shape regardless.
// The same shape, with the verb and the URL captured separately: the URL token
// must reach `safeUrlOrRedact` ALONE, because a request line contains a space
// and a space is exactly what that primitive redacts on (ADR 1030 §2).
// The verb list is CLOSED but the URL half is not (ADR 1031). Two problems were
// folded into one regex: `TRACE`, `CONNECT` and newer methods (`QUERY`) are real
// request lines this missed, and the URL token again restated `https?` where the
// primitive accepts seven schemes. Widening the verb to "a bare uppercase token"
// would swallow SQL (`DELETE FROM …` is why the list exists at all), so the shape
// stays anchored with NO spaces after the URL — and the URL token defers to the
// same scheme-agnostic form `URL_SHAPED` uses.
const HTTP_REQUEST_LINE = /^\s*([A-Z]{3,10})\s+((?:[a-z][a-z0-9+.-]*:\/\/|\/)\S*)$/;

/**
 * Drop the query/fragment of every URL embedded in a free-text string, keeping
 * scheme/host/path — deny-by-default (an arbitrary query param carries PII no
 * value-shape pattern can recognise). Covers scheme-bearing URLs (http/https/
 * ws/wss) and dotted-host protocol-relative URLs; leaves the rest of the string
 * untouched. Split out of `redactString` so the analytics sink can strip a URL's
 * query from a property WITHOUT redacting value shapes (which would clobber the
 * deliberate identify person payload — see `./analytics-scrub`).
 */
export function stripEmbeddedUrlQueries(value: string): string {
  let out = value;
  if (out.includes("://")) out = out.replace(EMBEDDED_URL_QUERY, "$1");
  if (out.includes("//")) out = out.replace(EMBEDDED_PROTOCOL_RELATIVE_URL_QUERY, "$1");
  return out;
}

/**
 * Redact every PII occurrence inside one string: first drop the query of any
 * embedded URL (deny-by-default), then apply the value-shape patterns.
 */
export function redactString(value: string): string {
  let out = stripEmbeddedUrlQueries(value);
  if (ANY_PATTERN.test(out)) {
    for (const pattern of STRING_PATTERNS) out = out.replace(pattern, REDACTED);
  }
  return out;
}

// ── The URL primitive (ADR 1030) ────────────────────────────────────────────
// Schemes whose authority and path we are willing to keep (ADR 1030 §3). An
// ALLOW-list, so an unknown scheme is denied by construction rather than by
// having been thought of — the previous rule kept "origin+path" for every
// scheme, which is VOID for a non-hierarchical one (`mailto:`, `tel:`, `data:`,
// `sms:`, `geo:`) where the payload IS the opaque path and there is no `?` to
// cut at, so a `mailto:` and a `data:text/csv` href shipped a surname and a
// rodné číslo in the clear. Keying opacity on the absence of `//` was rejected:
// `data://text/csv,<payload>` round-trips through that test and still delivers
// its body.
//
// SHRINKING THIS SET IS NOW SAFETY-MONOTONE, AND IT WAS NOT (ADR 1045).
// It used to be read with three OPPOSITE polarities: an allow-list here, a
// route-or-return-the-input-RAW gate in `reduceSourceLocation`, and a
// route-or-SKIP gate in `scrubDescription`. Under that arrangement dropping a
// scheme CLOSED one hole and OPENED two — measured: dropping `file:` makes the
// primitive redact `file:` values, and the same edit makes
// `file:///android_asset/www/index.html?surname=Novakova` survive WHOLE at the
// other two. Both inverted readers are now allow-list-polarity too: a
// non-member is REDACTED-TO-SCHEME (`data:[Filtered]`) rather than returned
// raw, so membership only ever means "keep more", at every reader, and removing
// an entry can only ever redact more. `redactTransaction` was already correct —
// it routes anything URL-shaped through the primitive, which redacts an
// unlisted scheme whole. Pinned in `./scrub.test`.
//
// MEMBERSHIP IS ARGUED FROM PRODUCERS WE SHIP, in both directions — a scheme is
// added only when a producer we ship is shown to emit it, and removed when that
// stops being true. Two entries currently FAIL that test and are flagged rather
// than silently kept:
//
//   · `file:` STAYS, but not for the reason previously written here. The old
//     comment justified it as a Capacitor/native PAGE origin, which is false for
//     this tree. The real producer is Node's ESM loader: a stack frame in an
//     ESM runtime is `file:///…/dist/x.js`, so removing `file:` would redact
//     every server frame's `filename` and break source-map resolution — the very
//     thing the source-location rule exists to protect.
//   · `capacitor:` / `ionic:` HAVE NO PRODUCER IN THIS TREE. Verified: no
//     `@capacitor/*` or `@ionic/*` dependency in any package.json, and no
//     reference in any source file. The mobile app is Expo / React Native, which
//     has no page URL at all. They are inherited entries, they are removal
//     candidates under this block's own rule, and removing them is now safe —
//     but it is a BEHAVIOUR change (a `capacitor://` value would go from
//     origin+path to `[Filtered]`) with no measured gain here, since the query
//     is already dropped for them. It belongs to its own decision, not to the
//     polarity repair that merely made it possible. Boarded, not taken.
const SAFE_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "file:", "capacitor:", "ionic:"]);

// Build-synthetic frame schemes: values that are a BUILD-ARTIFACT identifier and
// never a page URL, so they must survive BYTE-IDENTICAL or source-map resolution
// and issue grouping break. This is the second allow-list `reduceSourceLocation`
// consults, and writing it as an allow-list is the whole point of ADR 1045 — the
// rule it replaces was "anything not safe is returned raw", i.e. an exemption
// stated as a claim about what a value cannot contain.
//
// Producers, all shipped by this tree: Sentry's `RewriteFrames` (and the Next.js
// SDK) rewrite frames to `app:///…`; webpack and Turbopack emit
// `webpack-internal:///./src/x.tsx` and `webpack://_N_E/./src/x.tsx`; React
// server components surface `rsc://React/…`; Node's own internals are `node:…`.
// None of them can carry a page querystring, which is the leak this whole rule
// exists for. Anything NOT on either list is redacted to its scheme.
const FRAME_SYNTHETIC_SCHEMES = new Set(["app:", "webpack:", "webpack-internal:", "rsc:", "node:"]);

// PostHog's "no referrer" sentinel. Not a URL; must not be mangled into
// `/$direct`. Matched EXACTLY, never as a prefix — a test pins that
// `$directory` still redacts, so the exemption cannot widen into a rule.
const URL_SENTINELS = new Set(["$direct"]);

// A synthetic base, so a RELATIVE value can be handed to the parser at all. The
// host is in the reserved `.invalid` TLD and can therefore never collide with a
// real origin, which is what makes the `origin === SYNTHETIC_ORIGIN` test below
// a sound "this resolved where we put it" check.
const SYNTHETIC_BASE = "https://url-safety.invalid/";
const SYNTHETIC_ORIGIN = "https://url-safety.invalid";

// A URL-bearing value containing ASCII whitespace or a comma is NOT one URL.
// See `safeUrlOrRedact` — this is the whole list-valued-attribute defence, and
// it deliberately does not look at what the members are.
const NOT_ONE_URL = /[\s,]/;

// ── The `blob:` ALLOW-SHAPE (ADR 1032, superseding ADR 1030 §4) ─────────────
//
// `blob:` cannot be on `SAFE_SCHEMES`, because `protocol + "//" + host +
// pathname` is void for it: a `blob:` URL is NON-hierarchical, so its entire
// body arrives as one opaque `pathname` and there is no authority to rebuild
// from. It gets its own arm — and the arm is an ALLOW-SHAPE, not an exemption.
//
// The clause this replaces was written as an exemption ("there is nothing in a
// blob to redact") and recursed on that opaque body. The recursive call saw
// author-controlled text with no scheme, fell into the PATH-RELATIVE branch of
// this same function, resolved it against the synthetic base and returned it
// with a "/" bolted on: `blob:jan.novak@klient.cz` shipped as
// `blob:/jan.novak@klient.cz`, `blob:null/novakova-8001011234` as
// `blob:/null/novakova-8001011234`. Reachability of that branch from here WAS
// the defect, so nothing below recurses.
//
// THE MINTERS THIS FLEET SHIPS — an ENUMERATION, not a count. The clause this
// replaces read "exactly two bodies are legitimate, because exactly two kinds
// of origin can mint one", which is a sentence about the world rather than a
// predicate over the input — the exact tell ADR 1032 itself names as fail-open
// prose — and it was FALSE for the React Native / Expo lineage both skeletons
// ship (`apps/mobile` depends on `expo` and `react-native`, catalog `expo56`):
//
//   (a) a DOM document with an OPAQUE origin  → `blob:null/<uuid>`
//       (W3C File API §11: a sandboxed iframe, a `data:` or `file:` document).
//   (b) a DOM document with a TUPLE origin    → `blob:<origin>/<uuid>`
//       (W3C File API §11).
//   (c) the NATIVE runtime, ORIGIN-LESS       → `blob:<uuid>?offset=<int>&size=<int>`
//       Two independent minters produce it, verified in the installed packages:
//         · react-native `Libraries/Blob/URL.js` —
//           ``return `${BLOB_URL_PREFIX}${blob.data.blobId}?offset=${blob.data.offset}&size=${blob.size}`;``
//           where `BLOB_URL_PREFIX` gains its `//<host>/` suffix only when
//           `BLOB_URI_HOST` is a string. iOS `RCTBlobManager.mm` exports
//           `@"BLOB_URI_HOST" : [NSNull null]` beside `kBlobURIScheme = @"blob"`,
//           so the guard fails and the prefix stays the bare `blob:` — no
//           origin, no `/`. The id is `[NSUUID UUID].UUIDString`, i.e. an
//           UPPERCASE v4 uuid, which is why the `i` flag below is load-bearing.
//         · expo `src/winter/url.ts` ships its OWN `URL.createObjectURL` with
//           the identical template, and `src/winter/runtime.native.ts` does
//           `install('URL', () => require('./url').URL)` — so on the Expo
//           lineage these skeletons actually ship, that polyfill is the one
//           that wins.
//
// All three are matched on an anchored WHOLE shape, never a prefix.
//
// Android is NOT a fourth form and is deliberately NOT modelled. RN's
// `BlobModule.kt` returns `mapOf("BLOB_URI_SCHEME" to "content", "BLOB_URI_HOST"
// to resources.getString(resourceId))`, so that platform mints
// `content://<authority>/<uuid>?offset=&size=` — a `content:` URL that never
// reaches this arm at all and redacts on the scheme allow-list, before and
// after this change. A `content:` authority is an app-declared string, not a
// shape this module can prove; modelling it would mean allowing an arbitrary
// host, and the value redacts either way.

// The id every minter above emits. The version nibble is left open (1–8) rather
// than pinned to `4`: every shipping browser mints v4 today, but a future move
// to v7 must cost us a redaction we can see in a test, not the silent redaction
// of every blob URL in production. Case-insensitivity is a REQUIREMENT, not
// laxity — see minter (c), which mints uppercase.
const BLOB_OBJECT_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

// (a) The OPAQUE-origin body, minted literally as `null/<uuid>` by a document
// whose origin is opaque — a sandboxed iframe, a `data:` or `file:` document.
// The old arm CORRUPTED this one to `blob:/null/<uuid>`, i.e. it destroyed the
// single shape its own prose called browser-minted.
const BLOB_OPAQUE_ORIGIN_BODY = new RegExp(`^null/${BLOB_OBJECT_ID}$`, "i");

// (c) The ORIGIN-LESS body: the id alone, no origin and no `/` in front of it,
// because minter (c) has no origin to serialize. Anchored at both ends, so
// `blob:<uuid>/Novakova` and `blob:x<uuid>` are not this shape.
const BLOB_ORIGINLESS_BODY = new RegExp(`^${BLOB_OBJECT_ID}$`, "i");

// The ONE query this module accepts, anywhere — and only on form (c). It is
// matched against the WHOLE `search` parser field, so this is an EXACT SHAPE and
// never "a query is allowed here": both params, in the minted order, values
// non-negative integers, nothing before, between or after them. The answer is
// then re-serialized from the two capture groups, so the only author bytes that
// can reach a sink through this branch are `[0-9]` — the punctuation is this
// file's own literal. `?offset=0`, `?size=1234`, `?size=1234&offset=0`,
// `?offset=0&size=1&rc=8001011234`, `?offset=jan&size=novak`,
// `?offset=0%26size=1&x=2` and `?offset=0&size=1?offset=0&size=1` all fail the
// anchor and REDACT. The residual channel is two integer runs; the value-shape
// pass (`redactString`) still runs downstream of this primitive at every sink,
// so even an RČ-shaped digit run stuffed into `offset=` is caught there.
const BLOB_NATIVE_QUERY = /^\?offset=(\d+)&size=(\d+)$/;

// (b) The TUPLE-origin body's path, tested against the INNER parser's
// `pathname` — a parser field, so the browser-impossible query the outer parse
// already split into `search` cannot be smuggled through it.
const BLOB_OBJECT_PATH = new RegExp(`^/${BLOB_OBJECT_ID}$`, "i");

// The schemes a DOCUMENT can be served from, which is what a blob's tuple
// origin is. Deliberately NARROWER than `SAFE_SCHEMES`, and narrower on a
// stated rule rather than on taste: a `file:` document has an OPAQUE origin and
// therefore mints form (a), so a `blob:file:…` is proof the value was typed and
// not minted; and no document is ever served over `ws:`/`wss:`.
// `capacitor:`/`ionic:` ride along with their `SAFE_SCHEMES` membership — they
// are real page origins on the native build, so a blob minted on one is exactly
// as legitimate as the page that minted it.
const BLOB_ORIGIN_SCHEMES = new Set(["http:", "https:", "capacitor:", "ionic:"]);

function tryParseUrl(raw: string, base?: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

/**
 * Reduce a URL-bearing value to something safe, or REDACT it (ADR 1030 §1).
 *
 * This is the single primitive every URL sink routes through — Sentry fields,
 * analytics properties, `$elements` attributes, `$elements_chain` href values
 * and `$heatmap_data` keys — so a rule can never be closed at one sink and
 * missed at another. It replaces the "keep origin+path, cut at the first
 * `[?#]`" cut that six adversarial rounds each certified and each falsified.
 *
 * TWO PROPERTIES DO THE WORK, and neither is a rule that can be forgotten:
 *
 * 1. **Every safe answer is re-serialized from PARSER FIELDS**, never sliced out
 *    of the input. `protocol + "//" + host + pathname` — three fields the URL
 *    parser produced. `host` is `hostname[:port]` BY DEFINITION, so `username`
 *    and `password` are never read and userinfo cannot survive; `hash` is never
 *    read anywhere, and `search` is read at EXACTLY ONE place — the origin-less
 *    native blob form, where it must match `?offset=<int>&size=<int>` as a WHOLE
 *    field and the answer is rebuilt from the two integer capture groups — so an
 *    author's query cannot survive there either. There is no
 *    strip-the-credential rule here because there is nothing to strip: the
 *    credential was never in the output. That is what makes it hold at the NEXT
 *    sink somebody adds. `https://novakova:8001011234@evil.cz/x` reduces to
 *    `https://evil.cz/x`.
 *
 * 2. **A value that is not ONE url is redacted whole.** Round 6's
 *    `reducesToSingleUrl` asked whether a post-comma member was an ABSOLUTE URL,
 *    so `/a.png,//novakova:8001011234@evil.cz/x` — whose later member is
 *    protocol-relative — was returned byte-identical at all four sinks in both
 *    repos. This does not classify the members at all: whitespace or a comma
 *    means redact. `srcset`, `ping`, `imagesrcset` and any future list-valued
 *    attribute are covered without being named, and so is a framework binding
 *    expression (`isAdmin ? a : b`), which now redacts instead of being
 *    truncated at its ternary. The cost is a single URL with a raw comma in its
 *    path, taken KNOWINGLY: the alternative is a member-classification rule, and
 *    member-classification rules are exactly what the six rounds falsified.
 *
 * Deny-by-default throughout: an unparseable value, an unlisted scheme, and a
 * relative value that resolves somewhere other than the synthetic base all
 * REDACT. There is no path through this function that returns an unexamined
 * input byte — including the `blob:` arm, which ADR 1032 rewrote from an
 * EXEMPTION into a narrow allow-shape precisely because the exemption spelling
 * had falsified that sentence.
 */
export function safeUrlOrRedact(raw: string): string {
  const value = raw.trim();
  if (value === "") return "";
  if (URL_SENTINELS.has(value)) return value;
  if (NOT_ONE_URL.test(value)) return REDACTED;

  const absolute = tryParseUrl(value);
  if (absolute) {
    // `blob:` — kept only when the body is PROVABLY one of the three shapes
    // this fleet's minters produce (enumerated above), and REDACTED otherwise
    // (ADR 1032). Evaluated without recursion: the path-relative branch below
    // must not be reachable from here, because that reachability was the leak.
    if (absolute.protocol === "blob:") {
      // The outer parse already split any `?…` into `search`, so `body` is the
      // blob body and nothing else. `search` is consulted by form (c) alone,
      // and only against an anchored whole-field shape.
      const body = absolute.pathname;
      // (a) `blob:null/<uuid>`. Returned as-is only after an anchored
      // whole-shape match, so this is not an unexamined byte: it is 5 + 36
      // characters of `null/` and hex, or it is not this branch.
      if (BLOB_OPAQUE_ORIGIN_BODY.test(body)) return `blob:${body}`;
      // (c) `blob:<uuid>` — the ORIGIN-LESS native form, with or WITHOUT the
      // `offset`/`size` pair. The pair is optional because it is metadata, not
      // identity: a consumer that logs `url.split("?")[0]` hands us the bare
      // body, and that is the same minted value. Anything else in the query is
      // an unmodelled variant and redacts.
      if (BLOB_ORIGINLESS_BODY.test(body)) {
        if (absolute.search === "") return `blob:${body}`;
        const native = BLOB_NATIVE_QUERY.exec(absolute.search);
        if (!native) return REDACTED;
        return `blob:${body}?offset=${native[1]}&size=${native[2]}`;
      }
      // (b) `blob:<document-origin>/<uuid>`. Reduced through the same
      // rebuild-from-parser-fields rule as every other safe answer, so a
      // userinfo hidden in the body cannot survive here either.
      const origin = tryParseUrl(body);
      if (!origin) return REDACTED;
      if (!BLOB_ORIGIN_SCHEMES.has(origin.protocol)) return REDACTED;
      if (!BLOB_OBJECT_PATH.test(origin.pathname)) return REDACTED;
      return `blob:${origin.protocol}//${origin.host}${origin.pathname}`;
    }
    if (!SAFE_SCHEMES.has(absolute.protocol)) return REDACTED;
    return `${absolute.protocol}//${absolute.host}${absolute.pathname}`;
  }

  const relative = tryParseUrl(value, SYNTHETIC_BASE);
  if (!relative) return REDACTED;
  // Protocol-relative (`//host/path`): authority-bearing, so it keeps a host —
  // rebuilt from `host`, which is again what drops the userinfo. This is the
  // form round 3 and round 6 both escaped through.
  if (value.startsWith("//")) return `//${relative.host}${relative.pathname}`;
  // A path-relative value must resolve to the base we supplied. Anything else
  // means the parser found an authority or a scheme we did not account for.
  if (relative.origin !== SYNTHETIC_ORIGIN) return REDACTED;
  return relative.pathname;
}

/**
 * Reduce a SOURCE-LOCATION value (a stack frame's `filename` / `abs_path`) — the
 * one place this module deliberately returns its input (ADR 1031).
 *
 * The leak being closed is specific: in a browser stack frame these fields hold
 * the script's URL, and for an error from an inline or eval'd script that URL is
 * `location.href` — the page WITH its querystring.
 *
 * The leak therefore only ever arrives as an ABSOLUTE URL on a SAFE scheme,
 * because that is what a page URL is. Everything else in these fields is
 * synthetic and carries no page query: Sentry rewrites frames to `app:///…`,
 * bundlers emit `webpack-internal:///./src/x.tsx`, and a plain `ok.js` or
 * `/static/x.js` is relative. Those must survive BYTE-IDENTICAL — the full
 * primitive would rewrite `ok.js` to `/ok.js` and REDACT `app:///…` as an
 * unlisted scheme, and either breaks source-map resolution and issue grouping,
 * which is exactly what the structural exemption existed to protect.
 *
 * TWO ALLOW-LISTS, NEVER A FALL-THROUGH (ADR 1045). This function used to end in
 * `if (!SAFE_SCHEMES.has(...)) return value` — an exemption written as a claim
 * about what a non-safe scheme cannot contain, and the reason `SAFE_SCHEMES`
 * could not be shrunk safely. It is now stated the other way round: a SAFE
 * scheme is reduced by the primitive; a BUILD-SYNTHETIC scheme is returned
 * byte-identical (that is what protects source maps); anything else is
 * REDACTED-TO-SCHEME. `data:text/csv,Novakova` in a frame becomes
 * `data:[Filtered]` rather than shipping whole. The keep-the-scheme form is
 * deliberate over a bare `[Filtered]`: the scheme is this module's own literal,
 * carries no author bytes, and keeps the frame legible enough to tell a
 * rewritten frame from a hostile one.
 *
 * Module-local: the walk that consumes it lives in this same file. (web-native's
 * mirror MUST export it, because its PII registry sits in `@repo/utils` and the
 * walk is a package away — see its ADR 1025 §8.)
 */
function reduceSourceLocation(value: string): string {
  let parsed: URL | null;
  try {
    parsed = new URL(value);
  } catch {
    return value; // relative or unparseable — synthetic, no page query to lose
  }
  if (SAFE_SCHEMES.has(parsed.protocol)) return safeUrlOrRedact(value);
  if (FRAME_SYNTHETIC_SCHEMES.has(parsed.protocol)) return value; // app:, webpack-internal:, …
  return `${parsed.protocol}${REDACTED}`;
}

/**
 * Scrub a span/transaction `description`: an HTTP request line gets its query
 * dropped (keep the method + URL path); everything else (SQL, cache ops, …) is
 * only pattern-redacted so a "?"-bearing SQL statement is not truncated.
 */
export function scrubDescription(description: string): string {
  // The URL token is reduced on its own: `safeUrlOrRedact` redacts anything
  // containing whitespace (ADR 1030 §2), and a request line IS whitespace —
  // so the verb is split off and only the URL is handed to the primitive.
  const requestLine = HTTP_REQUEST_LINE.exec(description);
  if (requestLine) {
    return redactString(`${requestLine[1]} ${safeUrlOrRedact(requestLine[2] as string)}`);
  }
  // A description that IS a bare URL, with no verb. Sentry writes resource and
  // fetch spans this way, so a `capacitor://` or `https://` URL with a query
  // arrives here with no request line to match (ADR 1031). The guard is "no
  // whitespace AND parses absolute on a safe scheme", which is what makes this
  // safe on a field that also carries SQL and free prose: both contain spaces,
  // so neither reaches the primitive and neither is truncated at a stray "?".
  //
  // THE UNSAFE-SCHEME ARM IS NOT A SKIP (ADR 1045). It used to be — the condition
  // read `parsed && SAFE_SCHEMES.has(...)`, and anything else fell through to
  // plain pattern redaction, which is a deny-LIST and therefore misses an
  // arbitrary query. That is the inverted polarity that made shrinking
  // `SAFE_SCHEMES` unsafe, and it leaked for exactly the schemes where the path
  // IS the payload: `stripEmbeddedUrlQueries` only knows http/https/ws/wss, so
  // `file:///android_asset/www/index.html?surname=Novakova` and
  // `data:text/csv,Novakova` both arrived here and left unchanged. A non-safe
  // scheme is now REDACTED-TO-SCHEME, so membership means "keep more" here too.
  if (!/\s/.test(description)) {
    const parsed = tryParseUrl(description);
    if (parsed) {
      if (SAFE_SCHEMES.has(parsed.protocol)) {
        return redactString(safeUrlOrRedact(description));
      }
      return `${parsed.protocol}${REDACTED}`;
    }
  }
  return redactString(description);
}

/**
 * Scrub a Sentry event's `transaction` NAME — a route/operation identifier.
 * Default pageload/navigation names are pathname-only, but a custom or
 * auto-instrumented name can be a request line ("GET /api/clients?search=…") OR
 * a bare URL/path route ("/api/clients?search=…", "//host/x?…",
 * "https://host/x?…"). Deny-by-default: drop the query of any route-shaped name
 * (keep the verb + path), then pattern-redact. A non-route free-text label (no
 * leading verb-and-path, no URL/path shape) is only pattern-redacted, so a
 * legitimate "?" is never truncated. Unlike `scrubDescription`, a bare path (no
 * verb) is ALSO query-stripped — a transaction name is a route id, never prose.
 */
export function scrubTransaction(name: string): string {
  const requestLine = HTTP_REQUEST_LINE.exec(name);
  if (requestLine) {
    return redactString(`${requestLine[1]} ${safeUrlOrRedact(requestLine[2] as string)}`);
  }
  return redactString(URL_SHAPED.test(name) ? safeUrlOrRedact(name) : name);
}

// A URL-keyed value keeps origin+path, drops query. Handles the scalar, an
// array of URLs, and (defensively) a nested object — routing the last through
// the full walk so nothing under a `url`-named object escapes redaction. The
// array branch registers itself in `path` (like `scrubValue`) so a cyclic array
// is cut rather than recursed into forever.
function scrubUrlValue(value: unknown, path: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(safeUrlOrRedact(value));
  if (value === null || typeof value !== "object") return value;
  if (path.has(value)) return undefined; // genuine cycle — drop rather than recurse
  if (Array.isArray(value)) {
    path.add(value);
    const out = value.map((item) => scrubUrlValue(item, path));
    path.delete(value);
    return out;
  }
  return scrubValue(value, path); // objects → full walk (its own cycle guard)
}

// `path` tracks the CURRENT recursion chain only (add before descending,
// delete after), so true cycles are cut while diamond-shaped sharing — the
// same object referenced from two sibling branches, common in Sentry events —
// is cloned normally instead of being dropped on its second visit.
//
// `at` is ONE level of parent context and nothing deeper. Two rules need it, and
// both are about the immediate container rather than a path from the root:
//
//   · `underRequest` — set when the immediate parent key was `request`, consumed
//     only by `REQUEST_SCOPED_SENSITIVE_KEYS` (the raw request BODY). Sentry's
//     request interface is an object, never an array, so an array element is
//     never a direct child of it.
//   · `frame` / `framesArray` — the source-location allow-SHAPE (ADR 1044). A
//     stack frame is an ELEMENT of a `frames` array, so this takes two hops
//     rather than one: descending into a `frames` KEY sets `framesArray`, and
//     the array branch turns that into `frame` for each element. It is the array
//     branch's ONLY propagation, deliberately — an object nested deeper inside a
//     frame (a frame's `vars` bag, say) is not itself a frame and must not
//     inherit the exemption.
//
// Both reset on every further descent, which is the property that keeps this a
// context rather than a path stack.
type WalkContext = {
  /** the immediate parent key was `request` */
  underRequest?: boolean;
  /** this OBJECT is an element of a `frames` array, i.e. a stack frame */
  frame?: boolean;
  /** this ARRAY is the value of a `frames` key, so its elements are frames */
  framesArray?: boolean;
};

function scrubValue(value: unknown, path: WeakSet<object>, at: WalkContext = {}): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (path.has(value)) return undefined; // genuine cycle — drop rather than recurse
  path.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    const element: WalkContext = at.framesArray ? { frame: true } : {};
    out = value.map((item) => scrubValue(item, path, element));
  } else {
    const record: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      // The raw request BODY (`request.data`) — a blob no key rule can reach
      // into and no value shape matches. Checked first, and only under
      // `request`, so the `data` attribute bags stay walkable everywhere else.
      if (at.underRequest && REQUEST_SCOPED_SENSITIVE_KEYS.test(key) && entry != null)
        record[key] = REDACTED;
      else if (isSensitiveKey(key) && entry != null) record[key] = REDACTED;
      // A bare query string has no path worth keeping — drop it wholesale.
      else if (QUERY_ONLY_KEYS.test(key) && entry != null) record[key] = REDACTED;
      // A URL value keeps origin+path; the query (deny-by-default) is cut, then
      // the surviving path still runs pattern redaction (a token in the PATH,
      // e.g. /reset/<jwt>, is a value shape we catch).
      else if (URL_KEYS.test(key)) record[key] = scrubUrlValue(entry, path);
      // to/from ONLY when URL-shaped — never truncate free text at a stray "?".
      else if (PATH_KEYS.test(key) && typeof entry === "string" && URL_SHAPED.test(entry))
        record[key] = redactString(safeUrlOrRedact(entry));
      // A span `description` (transactions embed spans[] + contexts.trace, both
      // walked here, not through beforeSendSpan) — strip an HTTP request line's
      // query without truncating a SQL statement.
      else if (/^description$/i.test(key) && typeof entry === "string")
        record[key] = scrubDescription(entry);
      // The event's `transaction` NAME — a route/op id. A custom or instrumented
      // name can carry a ?query ("GET /api/clients?search=…"); drop it (keep the
      // route) without truncating a free-text op label at a stray "?".
      else if (/^transaction$/i.test(key) && typeof entry === "string")
        record[key] = scrubTransaction(entry);
      // A stack frame's script URL: a safe-scheme absolute URL is reduced by the
      // parser; a build-synthetic frame path stays byte-identical so source maps
      // still resolve; anything else is redacted to its scheme. Never
      // pattern-redacted either way — and ONLY inside a real frame (`at.frame`),
      // so a `filename` in an upload field or a breadcrumb bag falls through to
      // the ordinary walk below and is redacted like any other string.
      else if (at.frame && SOURCE_LOCATION_KEYS.test(key) && typeof entry === "string")
        record[key] = reduceSourceLocation(entry);
      else if (STRUCTURAL_KEYS.test(key) && typeof entry === "string") record[key] = entry;
      else
        record[key] = scrubValue(entry, path, {
          underRequest: REQUEST_KEY.test(key),
          framesArray: FRAMES_KEY.test(key),
        });
    }
    out = record;
  }
  path.delete(value);
  return out;
}

/**
 * Scrub a Sentry event (or any JSON-ish payload): every string field passes
 * `redactString`; values under sensitive keys are dropped wholesale; URL fields
 * keep their path and drop their query; structural SDK metadata (stack-frame
 * paths, release ids) passes through untouched. Pure — returns a scrubbed copy.
 * Generic so the bindings can hand it Sentry's own event types without this
 * neutral module importing an SDK.
 */
export function scrubEvent<E>(event: E): E {
  return scrubValue(event, new WeakSet()) as E;
}

/** Breadcrumb variant of `scrubEvent` (same walk; named for the SDK hook). */
export function scrubBreadcrumb<B>(breadcrumb: B): B {
  return scrubEvent(breadcrumb);
}

/**
 * Span-aware PII scrubber for `beforeSendSpan`. Raw spans are a SEPARATE
 * envelope path in Sentry v10 and are NOT event-shaped: the free-text PII rides
 * in `description` (SQL statements, HTTP URLs with query strings) and in the
 * `data` attribute bag (`url.full`, `db.statement`, `url.query`,
 * `http.request.header.referer`, …). Only those are redacted — the structural
 * identifiers (`span_id`, `trace_id`, `op`, timestamps) are spread through
 * untouched so trace correlation and grouping survive, where a blind
 * `scrubEvent` walk of the whole span could rewrite an all-digit id (the
 * rodné-číslo value pattern). Each `data` value goes through the SAME key rules
 * as the event walk (sensitive/query/url/path) and falls through to `scrubValue`
 * for anything else — so a NESTED object under a data key is recursed into, not
 * passed through raw. Generic + cast like `scrubEvent`, so this SDK-free module
 * needn't import Sentry's `SpanJSON` type. Lives here (not in
 * `sentry-options.ts`) so every scrub rule is single-homed and a change can't be
 * applied to one hook and missed on another.
 */
export function scrubSpan<S extends { description?: string; data?: Record<string, unknown> }>(
  span: S,
): S {
  const scrubDataEntry = (key: string, value: unknown): unknown => {
    if (isSensitiveKey(key) && value != null) return REDACTED;
    if (QUERY_ONLY_KEYS.test(key) && value != null) return REDACTED;
    if (URL_KEYS.test(key)) return scrubUrlValue(value, new WeakSet());
    if (PATH_KEYS.test(key) && typeof value === "string" && URL_SHAPED.test(value))
      return redactString(safeUrlOrRedact(value));
    return scrubValue(value, new WeakSet());
  };
  const { data, links } = span as S & { links?: { attributes?: Record<string, unknown> }[] };
  const scrubBag = (bag: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(bag).map(([k, v]) => [k, scrubDataEntry(k, v)])) as Record<
      string,
      unknown
    >;
  return {
    ...span,
    description: span.description != null ? scrubDescription(span.description) : span.description,
    data: data ? scrubBag(data) : data,
    // `links[].attributes` is the SECOND attribute bag on a span and it holds the
    // same key vocabulary as the first (ADR 1031) — `url.full`, `http.target`,
    // the header family. The spread carried it through untouched, so a value this
    // function redacts from `data` shipped verbatim from `links` in the same
    // envelope. Same bag type, same rules, one helper — the asymmetry is what
    // this lineage keeps being punished for.
    ...(links
      ? {
          links: links.map((link) =>
            link && link.attributes ? { ...link, attributes: scrubBag(link.attributes) } : link,
          ),
        }
      : {}),
  } as S;
}
