/**
 * Span-attribute redaction rules (ADR 0131) — PURE, and deliberately
 * DEPENDENCY-FREE at runtime.
 *
 * WHY THIS MODULE EXISTS AT ALL. Until ADR 0131 the OTel span pipeline had no
 * redaction whatsoever: `@fastify/otel` writes `url.path` from fastify's RAW
 * `request.url`, which INCLUDES the querystring, so the moment
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set every `?search=<příjmení>` that ADRs
 * 1011→1031 exist to strip out of Sentry and PostHog shipped verbatim to the
 * collector through a third sink nobody had looked at.
 *
 * WHY IT IMPORTS NOTHING. `otel/register.ts` runs pre-boot under
 * `node --import ./dist/otel/loader.js`, BEFORE any application module loads —
 * that is the whole point of the loader (the instrumentation hook must be
 * registered first). Two tempting imports are therefore forbidden here:
 *
 *   - `common/logging/redaction.ts`, the api's existing query-cut primitive,
 *     imports `@repo/db/pii` AND `@repo/db/schema` for its OTHER exports (the
 *     pii-registry-derived pino paths). Importing it would drag the entire
 *     Drizzle schema into the `--import` loader on every process start,
 *     including `migrate.js`.
 *   - `@repo/telemetry`, which owns the far better `safeUrlOrRedact`, is a
 *     SOURCE-ONLY package: its `exports` map points `.` at `./src/index.ts` and
 *     it has no `build` script, while apps/api compiles to ESM NodeNext `dist`
 *     and consumes only built packages. The edge is allowed by the eslint
 *     boundaries DAG and would still break `pnpm --filter api build`.
 *
 * So `safeUrlOrRedact` below is a DUPLICATE of
 * `packages/telemetry/src/scrub.ts`, forced by packaging and not chosen. It
 * keeps that function's STRUCTURE and its failure DIRECTION verbatim; the two
 * documented divergences are marked inline. The owed follow-up — give
 * `@repo/telemetry` a build step so the api can share the primitive instead of
 * mirroring it — is recorded in ADR 0131, because a duplicated security
 * primitive is exactly the thing that drifts.
 *
 * The public surface is `redactAttributes(scopeName, attributes)`, which
 * returns ONLY the entries that must be overwritten. Structural types (plain
 * `Record`s) rather than `@opentelemetry/api`'s `Attributes` keep even the
 * TYPE graph empty; every value this module produces is a `string`, which is a
 * valid `AttributeValue` at the call site.
 */

/** The single redaction marker. Same literal as `@repo/telemetry`'s `REDACTED`. */
export const REDACTED = "[Filtered]";

/**
 * URL schemes that may survive reduction — the SERVER vocabulary.
 *
 * `http`/`https`/`ws`/`wss`/`file` come from the shared lineage
 * (`packages/telemetry` `SAFE_SCHEMES`). `postgresql`/`postgres`/`redis`/
 * `rediss` exist ONLY here and are not owed upstream: they are the schemes of
 * `db.connection.string`, a server-side attribute with no browser counterpart.
 * Admitting them is what lets that attribute keep its host (real debugging
 * value) while still being REBUILT by the parser, so a credential the pg
 * instrumentation's own masker missed cannot survive.
 *
 * `capacitor:`/`ionic:` are deliberately ABSENT: they are native-build page
 * origins, unreachable inside a Node process, and a scheme admitted here that
 * nothing can emit is an allow-list entry no test can exercise.
 */
const SAFE_SCHEMES = new Set([
  "http:",
  "https:",
  "ws:",
  "wss:",
  "postgresql:",
  "postgres:",
  "redis:",
  "rediss:",
  "file:",
]);

/**
 * A synthetic base, so a RELATIVE value can be handed to the parser at all —
 * and `url.path` is ALWAYS relative (`/v1/clients?search=…`), so this is the
 * branch that carries the actual fix. The host is in the reserved `.invalid`
 * TLD and can therefore never collide with a real origin, which is what makes
 * the `origin === SYNTHETIC_ORIGIN` test below a sound "this resolved where we
 * put it" check.
 */
const SYNTHETIC_BASE = "https://url-safety.invalid/";
const SYNTHETIC_ORIGIN = "https://url-safety.invalid";

/**
 * A URL-bearing value containing ASCII whitespace or a comma is NOT one URL, so
 * it is redacted whole rather than classified member by member. Carried over
 * verbatim from `@repo/telemetry` — six adversarial rounds died on
 * member-classification rules (ADR 1030).
 */
const NOT_ONE_URL = /[\s,]/;

function tryParseUrl(raw: string, base?: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

/**
 * Reduce a URL-bearing value to something safe, or REDACT it (ADR 1030 §1,
 * mirrored here for spans).
 *
 * Every safe answer is RE-SERIALIZED FROM PARSER FIELDS, never sliced out of
 * the input: `protocol + "//" + host + pathname`. `host` is `hostname[:port]`
 * BY DEFINITION, so `username`/`password` are never read and userinfo cannot
 * survive; `search`/`hash` are never read, so a query cannot survive. There is
 * no strip-the-credential rule here because there is nothing to strip — the
 * credential was never in the output. Deny-by-default throughout: an
 * unparseable value, an unlisted scheme, and a relative value that resolves
 * somewhere other than the synthetic base all REDACT.
 *
 * TWO DOCUMENTED DIVERGENCES from the `@repo/telemetry` original, both
 * subtractions in the SAFE direction:
 *   - no `blob:` special case. A `blob:` URL is minted by
 *     `URL.createObjectURL` in a browser and cannot reach a Node span; without
 *     the exemption `blob:` simply fails the scheme allow-list and redacts.
 *   - no `URL_SENTINELS` ("$direct"). That is PostHog's no-referrer sentinel,
 *     an analytics-property concept with no span-attribute counterpart.
 */
export function safeUrlOrRedact(raw: string): string {
  const value = raw.trim();
  if (value === "") return "";
  if (NOT_ONE_URL.test(value)) return REDACTED;

  const absolute = tryParseUrl(value);
  if (absolute) {
    if (!SAFE_SCHEMES.has(absolute.protocol)) return REDACTED;
    return `${absolute.protocol}//${absolute.host}${absolute.pathname}`;
  }

  const relative = tryParseUrl(value, SYNTHETIC_BASE);
  if (!relative) return REDACTED;
  // Protocol-relative (`//host/path`): authority-bearing, so it keeps a host —
  // rebuilt from `host`, which is again what drops the userinfo.
  if (value.startsWith("//")) return `//${relative.host}${relative.pathname}`;
  // A path-relative value must resolve to the base we supplied. Anything else
  // means the parser found an authority or a scheme we did not account for.
  if (relative.origin !== SYNTHETIC_ORIGIN) return REDACTED;
  return relative.pathname;
}

/**
 * Attribute names whose value is URL- or path-BEARING → reduced by the parser.
 *
 * `url.path` is the one that leaks today and it is the reason this ADR exists:
 * `@fastify/otel` 0.18.1 sets it from `request.url`, fastify's RAW url, so it
 * is path+query. Its low-cardinality sibling `http.route` (the registered route
 * TEMPLATE, `/v1/projects/:id`) is deliberately NOT listed — it is authored by
 * us at route-registration time, carries no request data by construction, and
 * is the attribute every RED dashboard groups by.
 *
 * The rest are here on the deny-by-default principle rather than on evidence
 * that our four instrumentations emit them: `url.full`/`http.url`/`http.target`
 * are the standard spellings any HTTP instrumentation added later would use
 * (`http.target` is the exact key ADR 1016 was read out of, and like `url.path`
 * its value is a bare path+query that slips past every scheme-shaped defence),
 * and `db.connection.string` is written by BOTH the pg and the ioredis
 * instrumentation.
 */
const URL_KEYS = /^(url|url\.full|url\.path|http\.url|http\.target|db\.connection\.string)$/i;

/**
 * Attribute names whose value is a BARE query string or fragment — no path to
 * keep, so the whole value goes. `url.fragment`/`http.fragment` ride along
 * because the query and fragment writes are INDEPENDENTLY guarded in every SDK
 * that emits them, so a fragment can arrive with no query beside it
 * (ADR 1016/1030).
 */
const QUERY_ONLY_KEYS =
  /^(url\.query|http\.query|url\.fragment|http\.fragment|query_string|search)$/i;

/**
 * Attribute-name NAMESPACES redacted wholesale, prefix-matched.
 *
 * `http.request.header.*` / `http.response.header.*` is where an HTTP
 * instrumentation puts captured headers when someone turns capture on —
 * `authorization`, `cookie`, `referer` and anything a future proxy adds. A list
 * of header names would have to be remembered; a namespace does not.
 *
 * `db.query.parameter.*` is the semconv-stable home for bound SQL parameter
 * VALUES. Nothing writes it today (see `db.statement` below), and that is
 * exactly why it belongs here: the day somebody enables parameter capture it
 * must be a no-op, not a leak.
 */
const REDACTED_NAMESPACES = [
  "http.request.header.",
  "http.response.header.",
  "db.query.parameter.",
];

/**
 * Attribute names redacted wholesale, matched on the FULL key.
 *
 * `net.peer.ip` / `net.sock.peer.addr` / `client.address` / `http.client_ip`
 * are the caller's IP address — a `pii()` column of this repo's schema
 * (`ip_address`) under a telemetry-vendor spelling that no bare-name rule
 * reaches, the same asymmetry `packages/telemetry` documents. `http.user_agent`
 * / `user_agent.original` likewise mirror the `user_agent` column.
 * `enduser.id` is the authenticated principal.
 *
 * `db.postgresql.values` is the pg instrumentation's home for bound parameter
 * values under `enhancedDatabaseReporting: true`. We do not enable it, so this
 * entry is a TRIPWIRE, not a live rule: flipping that option on must not be
 * able to become a leak by omission.
 *
 * `net.peer.name` / `db.name` / `service.name` are pointedly NOT reachable
 * here, which is why this list matches full keys and the segment list below is
 * narrow. The pino/Sentry vocabulary redacts a bare `name` because there `name`
 * means `user.name`; in the span vocabulary it means the database host. The
 * same word, two sources of truth — ADR 1031's three-tier lesson applied
 * before it could bite.
 */
const SENSITIVE_KEYS =
  /^(net\.peer\.ip|net\.sock\.peer\.addr|client\.address|client\.socket\.address|http\.client_ip|http\.user_agent|user_agent\.original|enduser\.id|db\.postgresql\.values)$/i;

/**
 * UNAMBIGUOUS credential / PII words, matched against the whole key OR its last
 * dot-separated segment — so `authorization`, `http.request.authorization` and
 * a hand-written `app.user.email` are all reached without enumerating carriers.
 *
 * Every word here is one whose presence in an attribute name means the same
 * thing regardless of the namespace it sits in. Ambiguous words (`name`,
 * `image`, `identifier`, `user`, `host`) are excluded ON PURPOSE — in this
 * vocabulary they name infrastructure, and redacting `db.name` would be a
 * data-corruption rule wearing a redaction rule's clothes (ADR 1031).
 *
 * `ico` / `dic` are the Czech legal-person identifiers carried by this repo's
 * odběratel and are `pii()` columns here (the perimetra superset in
 * `packages/telemetry/src/scrub.ts` documents the same addition).
 */
const SENSITIVE_SEGMENTS =
  /^(authorization|cookie|cookies|set[-_]?cookie|password|passwd|secret|token|access[-_]?token|refresh[-_]?token|api[-_]?key|email|recipient[-_]?email|rodne[-_]?cislo|birth[-_]?number|phone([-_]?number)?|tel|iban|bank[-_]?account|ssn|national[-_]?id|session[-_]?id|ip[-_]?address|user[-_]?agent|ico|dic|postal[-_]?code)$/i;

/** Instrumentation scope names whose `db.statement` we know how to reduce. */
const IOREDIS_SCOPE = "@opentelemetry/instrumentation-ioredis";
const PG_SCOPE = "@opentelemetry/instrumentation-pg";

/**
 * Reduce an ioredis `db.statement` to the COMMAND NAME.
 *
 * `@opentelemetry/redis-common`'s default serializer emits
 * `` `${cmdName} ${args.join(" ")}` `` and its subset table gives `args: -1` —
 * i.e. EVERY argument — to a broad family that includes GET, DEL, EX*, EVAL,
 * SCAN, S*, Z* and L*. Redis arguments are our KEYS, and our keys are not inert:
 * `@nest-lab/throttler-storage-redis` embeds the client IP in the throttle key,
 * and session / idempotency keys embed principal ids.
 *
 * The trade is real and is taken knowingly: losing the key name costs
 * debuggability on BullMQ and throttle investigations, which then run off the
 * span NAME (`<command>`) and the pino line rather than off `db.statement`.
 */
function redisCommandOnly(statement: string): string {
  const [command] = statement.split(" ", 1);
  return command ?? REDACTED;
}

/**
 * Compute the attribute overwrites a span needs. Returns ONLY changed entries —
 * an empty object is the common case and costs the caller nothing.
 *
 * `scopeName` is the span's `instrumentationScope.name`; it is what lets
 * `db.statement` be reduced for redis and left alone for pg without either
 * decision being a guess about the value's shape.
 */
export function redactAttributes(
  scopeName: string,
  attributes: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const overwrites: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    const replacement = redactAttribute(scopeName, key, value);
    if (replacement !== undefined && replacement !== value) {
      overwrites[key] = replacement;
    }
  }

  return overwrites;
}

/**
 * The per-attribute rule table. Returns the replacement value, or `undefined`
 * when the attribute is left alone.
 *
 * Order matters: the wholesale-redaction rules run BEFORE the reducing ones, so
 * a key that is both sensitive and URL-shaped loses everything rather than
 * keeping a host.
 */
function redactAttribute(scopeName: string, key: string, value: unknown): string | undefined {
  if (REDACTED_NAMESPACES.some((namespace) => key.toLowerCase().startsWith(namespace))) {
    return REDACTED;
  }

  // `lastIndexOf` returns -1 for an undotted key, so this is the whole key —
  // one test covers both the bare and the namespaced spelling.
  const lastSegment = key.slice(key.lastIndexOf(".") + 1);
  if (SENSITIVE_KEYS.test(key) || SENSITIVE_SEGMENTS.test(lastSegment)) {
    return REDACTED;
  }

  if (QUERY_ONLY_KEYS.test(key)) return REDACTED;

  if (URL_KEYS.test(key)) {
    // A URL-bearing attribute that is not a string is a shape we do not model,
    // and an unmodelled shape redacts (ADR 1030's thesis).
    return typeof value === "string" ? safeUrlOrRedact(value) : REDACTED;
  }

  if (key === "db.statement") {
    if (typeof value !== "string") return REDACTED;
    if (scopeName === IOREDIS_SCOPE) return redisCommandOnly(value);
    // pg's `db.statement` is the PARAMETERIZED sql text (`… where id = $1`) and
    // nothing else: `instrumentation-pg` copies `queryConfig.text` verbatim and
    // captures bind VALUES only under `enhancedDatabaseReporting: true`, which
    // `register.ts` does not enable (and whose output key,
    // `db.postgresql.values`, is redacted above anyway). Keeping the sql text is
    // therefore a DELIBERATE recorded decision, not an oversight — it is the
    // single most useful attribute on a slow-query span. The residual risk is
    // named in ADR 0131: a raw `sql` template with an interpolated literal, or
    // an ILIKE built by string concatenation, would ship its value here, and no
    // rule at this layer can distinguish that from a placeholder.
    if (scopeName === PG_SCOPE) return undefined;
    // Any OTHER instrumentation's `db.statement` is an unmodelled shape.
    // Adding a mongo/mysql instrumentation must be a deliberate decision here,
    // not a silent new sink.
    return REDACTED;
  }

  return undefined;
}
