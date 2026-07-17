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

const REDACTED = "[Filtered]";

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

// An absolute URL embedded anywhere in a string: keep everything up to the
// path, drop the `?query`/`#fragment`. Requires `://` so a bare "1/2?x" in free
// text is never mistaken for a URL (the ambiguous relative case is left to the
// field-name rules, which know the value IS a URL). Replacement keeps group 1.
const EMBEDDED_URL_QUERY = /(\bhttps?:\/\/[^\s?#]*)[?#]\S*/gi;

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
const SENSITIVE_KEYS =
  /^(authorization|cookie|set-cookie|password|secret|token|access[-_]?token|refresh[-_]?token|api[-_]?key|email|rodne[-_]?cislo|birth[-_]?number|name|image|ip[-_]?address|user[-_]?agent|identifier|ico|dic|phone|address[-_]?line|city|postal[-_]?code)$/i;

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
const URL_KEYS = /^(url|url\.full|http\.url|referer|referrer|http\.request\.header\.referer)$/i;

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
const QUERY_ONLY_KEYS = /^(url\.query|http\.query|query_string|search)$/i;

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
 * Redact every PII occurrence inside one string: first drop the query of any
 * embedded absolute URL (deny-by-default), then apply the value-shape patterns.
 */
export function redactString(value: string): string {
  let out = value;
  // Cut the query/fragment of any absolute URL sitting in free text.
  if (out.includes("://")) out = out.replace(EMBEDDED_URL_QUERY, "$1");
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
function scrubValue(value: unknown, path: WeakSet<object>): unknown {
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
      if (SENSITIVE_KEYS.test(key) && entry != null) record[key] = REDACTED;
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
      else if (STRUCTURAL_KEYS.test(key) && typeof entry === "string") record[key] = entry;
      else record[key] = scrubValue(entry, path);
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
    if (SENSITIVE_KEYS.test(key) && value != null) return REDACTED;
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
