# ADR 0131 — OTel span attributes are redacted at the processor, and we now own the trace exporter chain

Date: 2026-07-28

## Status

Accepted.

## Context

### The third sink

ADRs 1011 through 1031 are a long, expensive lineage about one thing: a
querystring is a PII carrier, and a value spliced into a string cannot be
reached by a rule that addresses values by path. Six adversarial rounds ran over
that lineage. ADR 1030 finally inverted the rule — an unmodelled shape redacts —
and gave the repo a single primitive, `safeUrlOrRedact`, that reduces a
URL-bearing value by re-serialising it from URL-parser fields rather than
cutting it at a delimiter. ADR 1031 then found sixteen further defects, every
one of them in the code deciding whether to _call_ that primitive.

All of that work covered two sinks: Sentry and PostHog. Logs were covered
earlier and separately, by `common/logging/redaction.ts` (ADR 0036/0040).

There is a third sink, and nothing had ever looked at it.

`apps/api/src/otel/register.ts` booted a bare `NodeSDK` — `serviceName` and four
instrumentations, nothing else. No span processor, no sampler, no span limits.
Every span attribute produced by every instrumentation went to the collector
exactly as the instrumentation wrote it. Concretely:

- **`@fastify/otel` 0.18.1** builds its request span's attribute bag at
  `index.js:289-296` as `{ "fastify.root", "http.request.method", "url.path":
request.url }`, and `request.url` is fastify's **raw** url — path _and_
  querystring. So `GET /v1/customers?search=Nováková` produced a span carrying
  `url.path = "/v1/customers?search=Nováková"`. The same surname, in the same
  request, was stripped from the pino line by `redactedReqSerializer` and from
  the Sentry event by `scrubEvent`. It shipped intact on the span.
  `http.route`, set on the adjacent line from `request.routeOptions.url`, is the
  registered route TEMPLATE (`/v1/customers`) — low-cardinality, authored by us,
  and safe. Only `url.path` carries the query.
- **`@opentelemetry/instrumentation-ioredis` 0.66.0** serialises command
  arguments into `db.statement` using `@opentelemetry/redis-common`'s default
  serializer, whose subset table assigns `args: -1` — _every_ argument — to a
  regex family covering GET, DEL, EX\*, EVAL, SCAN, and the whole S\*/Z\*/L\*
  groups. Redis arguments are our keys, and our keys are not inert:
  `@nest-lab/throttler-storage-redis` embeds the client IP in the throttle key,
  and session and idempotency keys embed principal ids.

The exposure was latent rather than live only because `isOtelEnabled()` refuses
to boot the SDK until an exporter is configured. It would have gone live on the
first day anybody set `OTEL_EXPORTER_OTLP_ENDPOINT` — that is, on the day the
observability stack was actually turned on, with no code change and nothing to
review.

### Why a processor and not two hooks

Both leaks have a cheap, local fix. `@fastify/otel` accepts a `requestHook`;
`instrumentation-ioredis` accepts a `dbStatementSerializer`. Two options passed
to two constructors in `register.ts` would have closed both.

That is the shape ADR 1030 exists to reject. A hook attached to one emitter is a
rule that has to be remembered for the next emitter, and the next emitter — an
undici instrumentation, a mongo instrumentation, a vendor SDK, an application
`span.setAttribute` — arrives with no rule attached to it and nothing red. HQ's
ruling was "add the span processor", and the ruling's intent is a catch-all that
redacts shapes nobody modelled. A `SpanProcessor` sees every span from every
instrumentation scope, which is the only place that property can actually hold.

### The trap

Adding a span processor to `NodeSDK` looks like a one-line change. It is not,
and the reason is not discoverable from the types.

In `@opentelemetry/sdk-node` 0.218.0:

```js
// sdk.js:119-143 — the manual-config branch is entered iff any of these is set
if (configuration.traceExporter || configuration.spanProcessor || configuration.spanProcessors) {
  ...
  const spanProcessors = configuration.spanProcessors ?? [spanProcessor];
  this._tracerProviderConfig = { tracerConfig, spanProcessors };
}

// sdk.js:226-228 — and if it was entered, the env is never consulted
const spanProcessors = this._tracerProviderConfig
  ? this._tracerProviderConfig.spanProcessors
  : getSpanProcessorsFromEnv();
```

**Passing `spanProcessors` suppresses `getSpanProcessorsFromEnv()` entirely.**
`new NodeSDK({ spanProcessors: [redactor] })` therefore produces a tracer
provider holding the redactor and _no exporter_. The SDK starts. Spans are
created. `sdk.start()` does not throw, nothing is logged, the health checks stay
green, the redaction unit tests stay green — and not one trace ever reaches the
collector again. The failure is silent in every direction a test could look.

This ADR exists in large part to write that fact down, because a future reader
adding a sampler, a span limit or a second processor will otherwise rediscover
it the hard way, in production, weeks later.

An alternative was available and rejected: `sampler` is forwarded into
`NodeTracerProvider` via `...this._configuration` _without_ entering the
manual-config branch, so a wrapping sampler could rewrite attributes
(`Tracer.js` `Object.assign`es `samplingResult.attributes` over the
instrumentation's) while leaving the env exporter wiring intact. It was rejected
because a sampler is semantically the wrong home for redaction — a
`NOT_RECORD` decision short-circuits before span creation, `SamplingResult.attributes`
is typed `Readonly`, and correctly delegating to the env-selected default
sampler (parent-based / trace-id-ratio) is fiddly, unobvious work whose failure
mode is dropped traces. Trading a loud, owned exporter chain for a subtle
sampler is the wrong direction.

## Decision

### 1. A `RedactingSpanProcessor`, rewriting in `onStart`

`apps/api/src/otel/redacting-span-processor.ts` implements the full
`SpanProcessor` interface (`onStart`, `onEnd`, `forceFlush`, `shutdown`) and
does all of its work in `onStart` via the span's own `setAttribute`.

**Why `onStart`.** `SpanImpl`'s constructor applies the creation-time attribute
bag and _then_ calls `this._spanProcessor.onStart(this, opts.context)`, so every
attribute we care about — `url.path`, `db.statement` — is already populated and
the span is still writable. Neither other option works:

- **`onEnd`** receives a `ReadableSpan`. Its `attributes` object is mutable in
  practice (the `readonly` modifier is on the property, not the object) and
  writing to it directly would appear to work while bypassing
  `attributeCountLimit`, `attributeValueLengthLimit` and the SDK's internal
  `_attributesCount`. Using the supported `setAttribute` there is worse: it is a
  no-op after the span has ended _and_ emits a `diag.warn` carrying a
  constructed stack, once per span, on the hot path, with nothing red.
- **`onEnding`** is the other supported write point, fires before `_ended` is
  set, and would additionally catch attributes written mid-span. It is marked
  `@experimental` — "may break in minor versions of this package" — in the
  installed `@opentelemetry/sdk-trace-base` 2.7.1 declarations, and the otel
  packages are catalog-pinned _exact_ precisely because their minors churn. We
  decline to depend on a guarantee the maintainers explicitly withhold. The
  bounded cost is recorded below.

Types come from `import { tracing } from "@opentelemetry/sdk-node"` — sdk-node
re-exports `sdk-trace-base` wholesale as that namespace. This needs no new
dependency (`sdk-trace-base` is transitive-only and would not even _resolve_
from `apps/api` under pnpm's strict layout) and cannot version-skew from the SDK
that consumes the processor.

### 2. `redact-attributes.ts`, pure and import-free

The rules live in `apps/api/src/otel/redact-attributes.ts`, which imports
nothing at all — not at runtime and not in the type graph.

That constraint is real, not stylistic. `register.ts` runs pre-boot under
`node --import ./dist/otel/loader.js`, before any application module loads,
which is the entire point of the loader. So:

- it may **not** import `common/logging/redaction.ts`, the api's existing
  `stripQueryString`, because that module imports `@repo/db/pii` and
  `@repo/db/schema` for its other exports — importing it would drag the whole
  Drizzle schema into the `--import` loader of every process, including
  `migrate.js`;
- it may **not** import `@repo/telemetry`, which owns the far better
  `safeUrlOrRedact`, because that package is source-only: its `exports` map
  points `.` at `./src/index.ts` and it has no `build` script, while `apps/api`
  compiles to ESM NodeNext `dist` and consumes only built packages. The eslint
  boundaries DAG _allows_ the edge (`apps/*` is element type `app`, whose
  allow-list includes `telemetry`); the build is what would break, and lint
  would not have caught it.

**`safeUrlOrRedact` is therefore duplicated here, and the duplication is forced
by packaging, not chosen.** The copy keeps the original's structure and its
failure direction verbatim: every safe answer is re-serialised as
`protocol + "//" + host + pathname` from parser fields (so `username`,
`password`, `search` and `hash` are never read and cannot survive), a value
carrying whitespace or a comma is not one URL and redacts whole, and
unparseable / unlisted-scheme / resolves-off-the-synthetic-base all redact. Two
divergences are documented inline, both subtractions in the safe direction: no
`blob:` special case (browser-only; without the exemption it simply fails the
scheme allow-list) and no `$direct` sentinel (a PostHog concept). One addition:
`postgresql`/`postgres`/`redis`/`rediss` join the safe-scheme set, because
`db.connection.string` is a server-side attribute with no browser counterpart
and admitting its schemes is what lets it keep a host while still being rebuilt
by the parser.

**The owed follow-up is to give `@repo/telemetry` a build step so `apps/api` can
share the primitive instead of mirroring it.** A duplicated security primitive
is exactly the thing that drifts, and ADR 1031 is a 24-finding monument to what
drift in this area costs. That work is out of scope here because it changes a
package's publishing shape and every consumer's resolution, which is not a
change to make inside a security fix.

The rule table itself is in `OBSERVABILITY.md`. Three of its decisions are worth
recording as decisions rather than as configuration:

- **`http.route` is kept.** It is a route template authored at registration
  time, carries no request data by construction, and is the attribute every RED
  dashboard groups by. Redacting it would have destroyed the observability this
  whole subsystem exists for, for no gain.
- **Whole NAMESPACES redact** — `http.request.header.*`, `http.response.header.*`,
  `db.query.parameter.*`. Nothing writes them today; that is precisely why. A
  list of header names has to be remembered, a namespace does not, and the day
  someone enables header or bound-parameter capture it must be a no-op rather
  than a leak. `db.postgresql.values` is in the sensitive-key list for the same
  tripwire reason.
- **The sensitive-key vocabulary is narrower than pino's, on purpose.** The
  pino/Sentry list redacts a bare `name` because there `name` means `user.name`,
  a `pii()` column. In the span vocabulary `name` means `db.name`,
  `net.peer.name`, `service.name` — infrastructure. A last-segment rule carrying
  `name` would have been a data-corruption rule wearing a redaction rule's
  clothes, which is exactly the functional break ADR 1031 had to repair
  elsewhere. So unambiguous words (`authorization`, `email`, `token`, `iban`,
  `ico`, …) match on the last dot-segment, and ambiguous ones are reached only
  by full-key entries (`net.peer.ip`, `enduser.id`, `http.client_ip`, …).

### 3. `db.statement`: reduced for redis, kept for pg, redacted for everything else

**ioredis reduces to the command name.** The default serializer emits
`` `${cmdName} ${args.join(" ")}` `` and hands every argument to a broad command
family, and the arguments are keys that embed client IPs and principal ids.
**This is a real debuggability loss, taken knowingly**: BullMQ and throttle
investigations lose the key name from `db.statement` and must run off the span
name and the pino line instead. A key-shaped allow-list was not attempted — that
is the member-classification approach ADR 1030's six rounds falsified.

**pg's `db.statement` is left untouched, and that is a recorded decision rather
than an omission.** `instrumentation-pg` copies `queryConfig.text` — the
parameterized sql, `… where "id" = $1` — and captures bind _values_ only under
`enhancedDatabaseReporting: true`, which `register.ts` does not enable and whose
output key (`db.postgresql.values`) this ADR redacts anyway. The sql text is the
single most useful attribute on a slow-query span. The residual risk is named
and accepted: a raw `sql` template with an interpolated literal, or an ILIKE
built by string concatenation, would ship its value here, and no rule at this
layer can distinguish that from a placeholder. Drizzle parameterises, so this is
a code-review property, not a runtime one.

**Any other instrumentation's `db.statement` redacts.** Adding a mongo or mysql
instrumentation must be a deliberate decision in this file, not a silent new
sink.

### 4. We now own the trace exporter chain

Because of the trap, `apps/api/src/otel/exporter-processors.ts` reimplements
`getSpanProcessorsFromEnv()` — faithfully, not conveniently. It honours the
contract `OBSERVABILITY.md` already documented: `OTEL_TRACES_EXPORTER` of `otlp`
(default) | `console` | `none`, comma-lists tolerated, and for otlp the protocol
from `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? OTEL_EXPORTER_OTLP_PROTOCOL ??
"http/protobuf"`. `console` is paired with a `SimpleSpanProcessor` and
everything else with a `BatchSpanProcessor`, matching upstream.

The default protocol is `http/protobuf`, which means
`@opentelemetry/exporter-trace-otlp-proto` — a package `apps/api` did _not_
declare (it declared `exporter-trace-otlp-http`, i.e. `http/json`, and inherited
proto transitively through sdk-node). It is now a declared dependency in
`apps/api/package.json` at the same exact catalog pin as its siblings.
**Narrowing the default to `http/json` because that exporter was already there
would have made `OBSERVABILITY.md` a lie** for anyone who set only the endpoint,
and would have changed the wire format under them with nothing to notice.

`grpc` and `zipkin` are deliberately **not** supported for traces. Both are in
sdk-node's matrix; neither is in `OBSERVABILITY.md`'s (which describes an "OTLP
http collector"), and supporting them means `@grpc/grpc-js` and a zipkin
exporter in the production image for a path nothing exercises. They fail with a
`diag.error` naming the value and produce no exporter — never a silent
substitution, because posting protobuf at a gRPC endpoint is a failure that
looks like a network problem for a week.

Two properties close the trap:

- **The redactor is first in the array.** `MultiSpanProcessor` fans out in array
  order. A test pins it, because getting it wrong leaves a live leak under a
  green suite.
- **Empty means empty, and loud means loud.** When nothing exports,
  `buildSpanProcessors` returns `[]` rather than a lone redactor — sdk.js skips
  registering a tracer provider on an empty array, which reproduces the env
  path's `OTEL_TRACES_EXPORTER=none` behaviour exactly, whereas a padded array
  would register a provider that records spans and drops them: the trap
  reintroduced from the other side. And when traces _are_ configured but no
  exporter could be built, a `diag.error` says so in as many words. Silence is
  the whole danger here.

### 5. Tests

`apps/api/src/otel/*.test.ts` — colocated per repo convention
(`tsconfig.build.json` already excludes `*.test.ts`). There was no otel test in
`apps/api` before this, so these define the pattern: pure-function tests for the
rule table, a structural fake span for the processor (declaring only the members
the processor is allowed to use), and an injected env record for the exporter
matrix. 26 cases covering the query strip, userinfo, deny-by-default on
unparseable input, sensitive keys, the infrastructure names that must _not_
redact, both `db.statement` treatments plus the unmodelled-scope case, the
protocol/exporter matrix, and redactor-first ordering. Two rules were disarmed
to confirm the tests genuinely red (dropping `url.path` from the URL key list
reddened two; reversing the processor order reddened the third).

## Consequences

- The span pipeline stops being an unguarded PII sink. `?search=<příjmení>` is
  now stripped at all three sinks — logs, Sentry, traces — instead of two.
- **`apps/api` owns its trace exporter wiring** and must maintain it across
  sdk-node upgrades. This is a real, permanent maintenance cost accepted in
  exchange for catch-all redaction; the alternative was a sampler-based hack or
  per-emitter hooks that do not generalise. Anyone touching `register.ts` must
  read `exporter-processors.ts` first — `register.ts` says so.
- **`grpc` and `zipkin` trace exporters are no longer reachable**, where they
  were (undocumented but functional) before. Documented in `OBSERVABILITY.md`;
  restoring either means declaring the exporter package and a case in the
  switch.
- **Attributes written after span start are not redacted.** This is the bounded
  cost of declining `onEnding`: a `responseHook`, or an application-level
  `span.setAttribute`, lands after `onStart` has run. No installed
  instrumentation does this with a PII-bearing value today. Revisit if
  `onEnding` leaves `@experimental`.
- **Span EVENTS are out of scope.** `exception.message` and
  `exception.stacktrace` live on events, not attributes, and the processor does
  not touch them. An SMTP 550 embeds the recipient address in its message (ADR
  0129 records the same hazard for logs). Named as a known residual, not fixed
  here.
- **A security primitive is now duplicated**, and duplicated primitives drift.
  Mitigated by an explicit header comment in both directions and by this ADR;
  properly fixed only by giving `@repo/telemetry` a build step, which is the
  owed follow-up.
- ioredis `db.statement` no longer carries key names, costing debuggability on
  queue and throttle investigations.
- **THE SAME GAP EXISTS UPSTREAM AND IS OWED.**
  `/home/dchozen1/fullstack-skeleton/apps/api/src/otel/register.ts` is
  character-identical to the file this ADR fixes — same bare `NodeSDK`, same four
  instrumentations, same catalog-pinned otel deps — so channel A ships the same
  unredacted span pipeline to every project stamped from it. **This ADR does not
  touch the skeleton repo; it records the debt.** The upstream fix belongs in the
  ≥1000 skeleton-owned band (ADR 1000), and until it lands a channel-A drain
  that overwrites `apps/api/src/otel/register.ts` will silently revert this fix —
  the drain must carry the `spanProcessors:` line and the three new modules
  forward.

## Sources

Read directly from the installed packages in `node_modules/.pnpm`, not from
documentation:

- `@opentelemetry/sdk-node` 0.218.0 — `build/src/sdk.js:119-143` (the
  manual-config branch) and `:226-228` (`_tracerProviderConfig ? … :
getSpanProcessorsFromEnv()`); `build/src/utils.js:91-155`
  (`getOtlpProtocolFromEnv`, `getOtlpExporterFromEnv`,
  `getSpanProcessorsFromEnv`); `build/src/index.d.ts:8` (`export * as tracing`).
- `@opentelemetry/sdk-trace-base` 2.7.1 — `build/src/SpanProcessor.d.ts` (the
  four required members, `onEnding` optional and `@experimental`);
  `build/src/Span.js:69-74` (scope assignment, then `setAttributes`, then
  `onStart`, all inside the constructor), `:79-80` and `:339-345`
  (`setAttribute` no-op plus `diag.warn` after end); `build/src/index.d.ts`
  (exported surface).
- `@fastify/otel` 0.18.1 — `index.js:289-296` (`ATTR_URL_PATH: request.url`,
  `ATTR_HTTP_ROUTE: request.routeOptions.url`).
- `@opentelemetry/instrumentation-ioredis` 0.66.0 and
  `@opentelemetry/redis-common` 0.38.3 — `build/src/index.js`
  (`defaultDbStatementSerializer`, the `args: -1` regex family).
- `@opentelemetry/instrumentation-pg` 0.70.0 — `build/src/utils.js:175-207`
  (`db.statement` = `queryConfig.text`; values only under
  `enhancedDatabaseReporting`, on `db.postgresql.values`).
- `packages/telemetry/src/scrub.ts` — `safeUrlOrRedact` (ADR 1030 §1) and the
  `SENSITIVE_KEYS` / `URL_KEYS` / `QUERY_ONLY_KEYS` vocabularies this file
  mirrors and deliberately narrows.
- URL-parser behaviour (userinfo dropped by `host`, non-special-scheme parsing,
  synthetic-base resolution) verified by execution under node 24.
