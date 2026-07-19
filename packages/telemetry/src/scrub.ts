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
// WHERE THE QUERY ENDS is the whole difficulty, and it has two failure modes
// pulling in opposite directions:
//
//   - A bare `\S*` tail never leaks, but a URL embedded in a STRUCTURED carrier
//     — a JSON-ish breadcrumb (`{"url":"https://a/b?c=1","user":"x"}`) — has no
//     whitespace to stop at, so the match runs past the carrier's closing quote
//     and destroys every following field.
//   - Excluding the delimiters outright (`[^\s"'<>]*`) spares the carrier but
//     UNDER-REDACTS: it stops at the first quote *anywhere*, including one
//     inside a query value, so `?token="abc"&surname=Novakova` keeps the
//     surname. Nothing downstream catches that — a bare surname matches no
//     value-shape pattern, which is exactly why this deny-by-default cut exists.
//
// perimetra keeps `\S*` and REJECTS upstream's carrier-sparing bound, because
// that goal is not safely achievable here. Two successive attempts to spare the
// carrier were both broken by an adversarial pass, and they failed the same way:
// any rule that infers the boundary from LOCAL CONTEXT ("a quote followed by
// structure closes the carrier") can be defeated by planting that exact shape
// inside the value. `?a=x":Novakova` ends the match at the planted quote and
// strands the surname. Narrowing the rule to the first quote does not help — the
// planted quote IS the first one. And the carrier's own closing quote is
// indistinguishable from a planted one by construction, so there is no local
// test that separates them.
//
// The cost of `\S*` is real and accepted: a URL inside a structured carrier
// (`{"url":"https://a/b?c=1","user":"x"}`) loses the rest of the carrier, not
// just its query. That is an OBSERVABILITY bug. The alternative is a GDPR bug.
// A scrubber must fail toward over-redaction, so the whitespace-bounded tail
// stands and the carrier is sacrificed.
const QUERY_TAIL = String.raw`\S*`;

const EMBEDDED_URL_QUERY = new RegExp(
  // NO `\b` before the scheme. A word character glued to the scheme
  // (`requesthttp://svc/x?token=…`, easily produced by string concatenation in a
  // log line) defeats a word-boundary anchor, and the protocol-relative pass
  // cannot cover for it when the host is single-label (`internal-svc`, the
  // ordinary k8s service-name shape) because that pass requires a dotted host.
  // With both guards missed the string was passed through with ZERO redaction.
  // Dropping the anchor only ever makes this match MORE text, which is the safe
  // direction for a scrubber; the `://` requirement still prevents a bare
  // "1/2?x" from being mistaken for a URL.
  String.raw`((?:https?|wss?):\/\/[^\s?#]*)[?#]${QUERY_TAIL}`,
  "gi",
);

// A PROTOCOL-RELATIVE URL ("//cdn.host/path?q=…") embedded in free text: no
// scheme to anchor on, so it is guarded by a DOTTED host (a real domain) — this
// keeps a bare "// a comment?" or a "src/a//b?c" path fragment from being
// truncated at a stray "?". An optional `:port` is part of the authority
// ("//api.stg.example.com:8443/x?q=…"): without it the host group ends at the
// ":" and the whole match fails, leaving the query intact. Keeps `//host/path`,
// drops the query/fragment; shares the carrier-aware tail above so the two
// passes cannot drift apart.
const EMBEDDED_PROTOCOL_RELATIVE_URL_QUERY = new RegExp(
  String.raw`(\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/[^\s?#]*)?)[?#]${QUERY_TAIL}`,
  "gi",
);

// Keys whose VALUES are redacted wholesale, wherever they appear in an event.
// The PII registry (packages/db/src/pii.ts, ADR 0040) "drives the Sentry
// beforeSend scrubber", so every pii()-registered column NAME is mirrored here:
// name/email/image (user), ip_address/user_agent (session), identifier
// (verification), and the customer odběratel fields ico/dic/phone/address_line/
// city/postal_code (ADR 0071/0082). Add the bare column name when a new pii()
// column lands — the registry is the source of truth, this list is the
// telemetry-sink mirror. `scrub.pii-contract.test.ts` guards the mirror against
// drift: telemetry can't import @repo/db (extension-less for Metro + the DAG
// forbids the edge), so the test reads the schema SOURCE and asserts the
// scrubber redacts every pii() column name rather than importing the registry.
//
// `cookies` (PLURAL) is a CONTAINER, not a scalar, and it is here for a reason
// the singular entry does not cover (ADR 1017). Sentry's
// `requestDataIntegration` — a DEFAULT integration — sets `event.request.cookies`
// to the PARSED cookie jar (`parseCookie(headers.cookie)`) whenever
// `include.cookies` is truthy, and the default with `sendDefaultPii: false` is an
// OBJECT (`{deny: […]}`), i.e. `!== false`, so it is truthy. Unlike the SPAN
// path, the EVENT path applies no filtering of its own; and it runs in
// `processEvent`, so this is the ERROR path — `tracesSampleRate: 0` is no
// protection.
//
// The container must be dropped WHOLESALE rather than left to the walk, because
// a cookie NAME is not drawn from any vocabulary this list can enumerate. This
// repo's own production session cookie is `__Host-auth_session_token`
// (packages/auth), which matches neither `token` nor `access[-_]?token` nor
// `refresh[-_]?token` — all anchored — and whose value (two dot-separated
// segments) matches no value SHAPE either, since the JWT pattern needs three. So
// the walk descended into the jar, found nothing it recognised, and shipped an
// httpOnly session token in the clear next to the `headers.cookie` copy of the
// SAME secret that this list redacts one key away. Anchoring is what keeps
// `cookie` from eating `cookiePreferences`; the cost is that it cannot see a
// plural, and every plural container has to be named.
//
// This list is a `pii()` column mirror PLUS a generic credential/PII vocabulary,
// and the second half is not optional (ADR 1019). `phone`/`tel`, `iban`,
// `bank_account`, `ssn`/`national_id` and `session_id` are not all columns in
// this schema, but neither are `authorization`, `cookie`, `password`, `secret`,
// `token`, `api_key` or `rodne_cislo` — "it isn't a pii() column" was never this
// list's membership test, so it cannot explain their absence. (`phone`, `ico`,
// `dic`, `address_line`, `city` and `postal_code` ARE columns here — the customer
// odběratel fields of ADR 0071/0082 — so they carry both obligations at once.)
//
// The obligation is this module's own, stated in its header: the scrubber exists
// because `@repo/validators/primitives/cz.ts` ships a rodné-číslo validator, so a
// validated-but-REJECTED candidate rides along in form state. That same file
// ships `bankAccount` and `iban` a few lines away, and `phoneE164` sits in
// primitives/index.ts — identical minting, identical obligation, discharged for
// one and not the others. None of these values has a shape any STRING_PATTERN
// catches (the four are Bearer, JWT, email and the rodné-číslo digit shape), so
// the KEY list is the only defence that exists for them. `bank_account` looked
// half-covered only by accident: the rodné-číslo pattern happens to eat a
// 10-digit account number and leave the bank code ("19-[Filtered]/0800"), which
// is a value-shape coincidence, not coverage.
//
// `session_id` is the weak one and is listed with open eyes: real session-cookie
// names (`__Host-auth_session_token`, `connect.sid`, `next-auth.session-token`)
// match no anchor here, which is exactly why the `cookies` CONTAINER above is the
// rule that actually protects the session. `session_id` only catches a
// hand-rolled `{ session_id: … }` context field.
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
// hand-written form field or context bag actually uses. Anchored, so it cannot
// touch `rcVersion` or any `rc` substring — a release-candidate field would have
// to be named exactly `rc`, and over-redacting that is the cheap side of the
// trade.
const SENSITIVE_KEYS =
  /^(authorization|cookie|cookies|set-cookie|password|secret|token|access[-_]?token|refresh[-_]?token|api[-_]?key|email|rodne[-_]?cislo|birth[-_]?number|rc|phone([-_]?number)?|tel|iban|bank[-_]?account|ssn|national[-_]?id|session[-_]?id|name|image|ip[-_]?address|user[-_]?agent|identifier|ico|dic|address[-_]?line|city|postal[-_]?code)$/i;

// The SDK-ATTRIBUTE forms of concepts `SENSITIVE_KEYS` already owns (ADR 1017).
// Kept SEPARATE from that list deliberately: `SENSITIVE_KEYS` is the hand-mirror
// of the `pii()` column registry and `scrub.pii-contract.test.ts` guards it
// against registry drift, so it must stay a list of bare COLUMN names. These are
// telemetry-vendor attribute names, a different source of truth (the installed
// SDK bundles), and mixing them would make the mirror unreadable.
//
// Why a bare-name list cannot reach them: `SENSITIVE_KEYS` is anchored, so
// `ip[-_]?address` cannot match `http.client_ip` or `net.peer.ip`, and
// `user[-_]?agent` cannot match `http.user_agent` or `user_agent.original`. Yet
// these are written as PLAIN LITERALS in the same `startSpan` attributes bag as
// `http.target` (`@sentry/core` integrations/http/server-subscription.js, and
// verbatim again in `@sentry/node-core` httpServerSpansIntegration.js) — the very
// literal the `http.target` fix of ADR 1016 was read out of. None is gated on
// `sendDefaultPii`; `http.client_ip` is `headers["x-forwarded-for"]` and
// `net.peer.ip` is the socket's remote address. `spanToTransactionTraceContext`
// spreads the whole attribute bag onto `contexts.trace.data`, so they reach
// `beforeSendTransaction` by exactly the route ADR 1016 documents.
//
// `net.peer.ip` is redacted; `net.host.ip` / `net.host.port` are NOT, and that
// asymmetry is settled by the emitters rather than by preference (ADR 1019).
// Across the whole dependency tree `net.host.ip` has exactly two writers and both
// are SERVER spans assigning `localAddress`: `@sentry/core`
// integrations/http/server-subscription.js (`"net.host.ip": localAddress`, in an
// object literal that also hardcodes `"otel.kind": "SERVER"`) and
// `@sentry/node-core` httpServerSpansIntegration.js
// (`newAttributes[SEMATTRS_NET_HOST_IP] = localAddress` — the CONSTANT form, so a
// literal-string grep alone does not find it; the claim must be checked over both
// spellings). The client-span emitter, integrations/http/get-outgoing-span-data.js,
// writes `net.peer.name` / `net.peer.ip` / `net.peer.port` and never `net.host.*`
// at all. So `net.host.*` IS the local side at every emission site, and per OTel
// semconv generally. Span direction changes whether the PEER is an end user or an
// upstream service — which is exactly why `net.peer.ip` stays on this list —
// never which side is local. `net.host.ip` is the server's own address, the same
// category as `server_name`, which `STRUCTURAL_KEYS` already exempts.
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
// The `user_agent` member takes the same `(request|response)` shape.
// `httpHeadersToSpanAttributes` generates `http.<request|response>.header.<name>`
// from whichever header bag it is given and does not special-case direction, so
// scoping our rule to `request` alone would be drift rather than a decision — and
// the response side costs nothing to cover.
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
// `data` there is the raw, UNPARSED request BODY (ADR 1017): `include.data` is
// hardcoded `true` in `requestDataIntegration` ("Always attach body data that's
// already on the scope"), and `httpServerIntegration` captures up to
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
// operates on, and breadcrumbs carry `data` too. A global `data` rule would blind
// the scrubber's own `http.target` / `url.query` / fragment coverage by redacting
// the bag before the walk could reach the keys inside it — trading a leak for a
// bigger blind spot.
const REQUEST_SCOPED_SENSITIVE_KEYS = /^data$/i;
const REQUEST_KEY = /^request$/i;

// SDK/build metadata that is never user input: stack-frame locations, module
// and symbol names, release/build identifiers. Exempt from string redaction so
// a purely-numeric chunk filename or dotted module name can't be rewritten to
// "[Filtered]" (which would break source-map resolution and issue grouping).
// SENSITIVE_KEYS is checked first and wins on any overlap.
const STRUCTURAL_KEYS =
  /^(filename|abs_path|module|function|event_id|release|dist|environment|server_name|platform)$/;

// ── Deny-by-default URL query stripping (ADR 1011) ──────────────────────────
// Field NAMES whose value is ALWAYS a URL → unconditionally keep scheme://host/
// path, drop ?query and #fragment. `url` (fetch/xhr breadcrumb data + event
// request.url, reached by the walk), `url.full`/`http.url` (span data),
// `referer`/`referrer` (event request.headers, set by the default browser
// httpContextIntegration = the full referring URL with query) and its span
// attribute form `http.request.header.referer`.
//
// `http.target` is the one that bites hardest, and it is NOT optional (ADR 1016).
// Unlike every other key here its value is path+query
// (`/clients?search=Nováková`), NOT an absolute URL — so it slips past every
// other defence in this module. SENSITIVE_KEYS is anchored and has no `target`;
// QUERY_ONLY_KEYS and STRUCTURAL_KEYS do not match it; so it fell to the default
// `scrubValue` branch, whose `stripEmbeddedUrlQueries` requires either a `://` or
// a dotted `//host` — a bare path has neither, so BOTH embedded-URL passes are a
// no-op and the querystring survived verbatim.
//
// The attribute is not exotic: this repo's `apps/web` is a Next.js app, and
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
// and drops the query, exactly like the absolute forms above. The mobile binding
// shares this scrubber but does not set `http.target`, so this rule is a
// server-tracing fix, not a universal one.
const URL_KEYS =
  /^(url|url\.full|http\.url|http\.target|referer|referrer|http\.request\.header\.referer)$/i;

// Ambiguous PATH fields: a navigation breadcrumb's `to`/`from` ARE same-origin
// paths that can carry ?search=, but `to`/`from` are also generic key names for
// free text (confirmation copy, chat, form labels). Strip the query ONLY when
// the value is actually URL/path-shaped, so a "Cancel? yes" is never truncated.
const PATH_KEYS = /^(to|from)$/i;
const URL_SHAPED = /^(?:https?:)?\/\/|^\//; // http(s)://, protocol-relative //, or a leading /

// Field NAMES whose value is a BARE query string (no path to keep) → drop the
// whole value. `url.query`/`http.query` (span data), `query_string` (event
// request.query_string), `search` (a raw search-param bag — the typed search
// term, precisely the ?search=<surname> leak class).
//
// `url.fragment`/`http.fragment` are the FRAGMENT twins (ADR 1016), written by
// the SDK on the source line adjacent to `http.query`: browser xhr/fetch spans
// (`@sentry/browser` tracing/request.js and `@sentry/core` fetch.js),
// outgoing-request breadcrumbs (`add-outgoing-request-breadcrumb.js`), and the
// OTel bridge (`@sentry/opentelemetry` resource-*.js). Do NOT reason that the
// twins ride together and so a covered key always shields its sibling — the two
// writes are INDEPENDENTLY guarded on `parsedUrl.search` and `parsedUrl.hash`, so
// a URL with a fragment and no querystring (`/path#email=jan@example.cz`) emits
// `http.fragment` with no `http.query` beside it at all.
//
// A bare fragment value has no scheme, so `stripEmbeddedUrlQueries` never fires
// and `dropUrlQuery` is never reached; and an arbitrary `#…` param has no value
// shape for the pattern pass to catch, which is the whole rationale for
// deny-by-default. Covering the query key but not its fragment sibling also
// contradicted this module's own policy — `dropUrlQuery` cuts at `[?#]`, not just
// `?`, i.e. the module already treats a fragment as unsafe everywhere it can see
// one.
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
const HTTP_DESCRIPTION = /^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(?:https?:\/\/|\/)\S*$/i;

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

/**
 * Cut a URL string at the first query/fragment delimiter, keeping origin+path.
 * Deny-by-default: everything after the first `?` or `#` is dropped wholesale
 * (an arbitrary query param carries PII no value-shape pattern can recognise);
 * the path is kept so a trace stays debuggable.
 */
export function dropUrlQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Scrub a span/transaction `description`: an HTTP request line gets its query
 * dropped (keep the method + URL path); everything else (SQL, cache ops, …) is
 * only pattern-redacted so a "?"-bearing SQL statement is not truncated.
 */
export function scrubDescription(description: string): string {
  const base = HTTP_DESCRIPTION.test(description) ? dropUrlQuery(description) : description;
  return redactString(base);
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
  const isRoute = HTTP_DESCRIPTION.test(name) || URL_SHAPED.test(name);
  return redactString(isRoute ? dropUrlQuery(name) : name);
}

// A URL-keyed value keeps origin+path, drops query. Handles the scalar, an
// array of URLs, and (defensively) a nested object — routing the last through
// the full walk so nothing under a `url`-named object escapes redaction. The
// array branch registers itself in `path` (like `scrubValue`) so a cyclic array
// is cut rather than recursed into forever.
function scrubUrlValue(value: unknown, path: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(dropUrlQuery(value));
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
        record[key] = redactString(dropUrlQuery(entry));
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
      return redactString(dropUrlQuery(value));
    return scrubValue(value, new WeakSet());
  };
  const { data } = span;
  return {
    ...span,
    description: span.description != null ? scrubDescription(span.description) : span.description,
    data: data
      ? (Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, scrubDataEntry(k, v)]),
        ) as Record<string, unknown>)
      : data,
  } as S;
}
