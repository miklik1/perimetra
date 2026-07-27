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
const STRING_PATTERNS: RegExp[] = [
  // Authorization header values: "Bearer <anything token-ish>".
  /\bBearer\s+[\w\-.~+/]+=*/gi,
  // Bare JWTs (three base64url segments).
  /\b[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}\b/g,
  // Emails.
  /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
  // Rodné číslo SHAPE: YYMMDD, optional "/", 3–4 digits — also catches the
  // slashless 9–10 digit form (see the fail-safe note above).
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
const EMBEDDED_URL_QUERY = /((?:https?|wss?):\/\/[^\s?#]*)[?#]\S*/gi;

// A PROTOCOL-RELATIVE URL ("//cdn.host/path?q=…") embedded in free text: no
// scheme to anchor on, so it is guarded by a DOTTED host (a real domain) — this
// keeps a bare "// a comment?" or a "src/a//b?c" path fragment from being
// truncated at a stray "?". An optional `:port` is part of the authority
// ("//api.stg.example.com:8443/x?q=…"): without it the host group ends at the
// ":" and the whole match fails, leaving the query intact. Keeps `//host/path`,
// drops the query/fragment; same whitespace-bounded tail as the scheme pass.
const EMBEDDED_PROTOCOL_RELATIVE_URL_QUERY =
  /(\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/[^\s?#]*)?)[?#]\S*/gi;

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
// its body. `capacitor:`/`ionic:`/`file:` are here on PROVENANCE — the
// web-native lineage's native build really does serve pages from those origins,
// and excluding them would redact every page view on that platform.
const SAFE_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "file:", "capacitor:", "ionic:"]);

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
 *    and `password` are never read and userinfo cannot survive; `search` and
 *    `hash` are never read, so a query cannot survive. There is no
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
 * input byte.
 */
export function safeUrlOrRedact(raw: string): string {
  const value = raw.trim();
  if (value === "") return "";
  if (URL_SENTINELS.has(value)) return value;
  if (NOT_ONE_URL.test(value)) return REDACTED;

  const absolute = tryParseUrl(value);
  if (absolute) {
    // `blob:` is exempt from the allow-list because there is nothing in it to
    // redact: its body is `<origin>/<uuid>` minted by `URL.createObjectURL`,
    // browser-generated and never author-controlled text. It is still reduced
    // rather than passed through — the inner URL goes through this same
    // function — so a `blob:` carrying a query loses it like anything else.
    if (absolute.protocol === "blob:") {
      const inner = safeUrlOrRedact(absolute.pathname);
      return inner === REDACTED ? REDACTED : `blob:${inner}`;
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
 * So: parse. A safe-scheme absolute URL is reduced like any other URL. Anything
 * else is returned unchanged and is NOT pattern-redacted — stated plainly as the
 * exemption it is, rather than hidden inside a key list.
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
  if (!SAFE_SCHEMES.has(parsed.protocol)) return value; // app:, webpack-internal:, …
  return safeUrlOrRedact(value);
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
  if (!/\s/.test(description)) {
    let parsed: URL | null;
    try {
      parsed = new URL(description);
    } catch {
      parsed = null;
    }
    if (parsed && SAFE_SCHEMES.has(parsed.protocol)) {
      return redactString(safeUrlOrRedact(description));
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
// `underRequest` is one level of parent context, set only when the immediate
// parent key was `request`, and consumed only by `REQUEST_SCOPED_SENSITIVE_KEYS`.
// It is deliberately NOT a full path stack: the single rule that needs it cares
// about a direct child of Sentry's request interface and nothing deeper, so it
// resets on every further descent.
function scrubValue(value: unknown, path: WeakSet<object>, underRequest = false): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (path.has(value)) return undefined; // genuine cycle — drop rather than recurse
  path.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => scrubValue(item, path));
  } else {
    const record: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      // The raw request BODY (`request.data`) — a blob no key rule can reach
      // into and no value shape matches. Checked first, and only under
      // `request`, so the `data` attribute bags stay walkable everywhere else.
      if (underRequest && REQUEST_SCOPED_SENSITIVE_KEYS.test(key) && entry != null)
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
      // parser; a synthetic or relative frame path stays byte-identical so
      // source maps still resolve. Never pattern-redacted either way.
      else if (SOURCE_LOCATION_KEYS.test(key) && typeof entry === "string")
        record[key] = reduceSourceLocation(entry);
      else if (STRUCTURAL_KEYS.test(key) && typeof entry === "string") record[key] = entry;
      else record[key] = scrubValue(entry, path, REQUEST_KEY.test(key));
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
