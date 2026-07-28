# ADR 0130 — The buyer's share token rides the URL fragment, not a path segment

**Status:** Accepted (2026-07-28). Supersedes the TRANSPORT half of
[ADR 0089](0089-buyer-public-nabidka-view.md) (the buyer surface's contract, trust boundary and
accept/decline lifecycle are unchanged); the rendered landing from
[ADR 0123](0123-nabidka-buyer-landing-reskin.md) is untouched. Closes the item recorded as open in
[ADR 1030](1030-url-bearing-values-are-reduced-by-the-parser-or-redacted.md) line 10.

## Context

The public buyer surface `/nabidka/[token]` is one of exactly two `@Public()` surfaces in the repo,
and the `[token]` path segment **is** the bearer credential: possession of the URL is the entire
authorisation to read a nabídka — buyer identity, line items, pricing, validity.

Every telemetry URL rule this repo has ever shipped reduces a URL by **keeping its pathname**. The
current primitive, `safeUrlOrRedact` (skeleton ADR 1030), rebuilds a URL as
`protocol + "//" + host + pathname` and never reads `username`, `password` or `search`; the
`dropUrlQuery` it replaced cut the string at `[?#]`. Both designs are correct about what they claim,
and both rest on the same unstated assumption: **the path carries no secret.** That assumption is
true of every route in the skeleton this repo was stamped from, and it was false here.

The consequence was concrete. Browser Sentry is really wired, and PostHog autocapture attaches
`$current_url` to every `$pageview`, so on that route `location.href` reached both sinks, passed
through the scrubber, and came back with the token intact — reduced, but not redacted. Every error,
breadcrumb, transaction name and pageview from a buyer's session would have carried a working
credential to a third-party service. The server side was no better: `pino-http` logs `req.url`, and
`GET /v1/quotes/shared/<token>` put the same credential in the api's own request log and in the
access log of any reverse proxy in front of it.

Nothing in the existing guard set could have caught it. The primitive is correct and its own
2520-case sweep proves it — but "payload" there means query and userinfo. `SENSITIVE_KEYS` matches
key NAMES, and the token is a positional path segment on the value side. The `pii()`-contract test
mirrors registered COLUMNS, and a share token correctly is not one. The defect was found by an
adversarial review of the W13 channel-A drain and verified byte-identical pre- and post-drain, so it
was pre-existing rather than introduced.

**Nothing in this repo has ever been deployed.** `SMTP_HOST=localhost` on the mailpit port,
`WEB_ORIGIN=http://localhost:3000`, no CD workflow, no git tag, no platform configuration — ADR 0129
was verified end-to-end through Mailpit. No buyer has ever received a link, so there is no
already-mailed URL contract to honour and **no migration is owed**. That fact is what makes the
structural fix available rather than merely desirable; an earlier framing that treated the link as
shipped was wrong, and ADR 1030 line 10 already recorded the correct state.

## Decision

**The share token moves out of the URL entirely and rides the URL fragment.**

The mailed link becomes `${WEB_ORIGIN}/nabidka#<shareToken>`. `/nabidka` becomes a **static** route
(no dynamic segment) that reads `location.hash` in the browser, `history.replaceState`s it away
before doing anything else, and sends the token in a **JSON request body**.

The api's three buyer endpoints become POSTs that take the token in the body, and the
path-parameterised forms are **removed, not deprecated**:

| Before                                       | After                            |
| -------------------------------------------- | -------------------------------- |
| `GET /v1/quotes/shared/:shareToken`          | `POST /v1/quotes/shared/resolve` |
| `POST /v1/quotes/shared/:shareToken/accept`  | `POST /v1/quotes/shared/accept`  |
| `POST /v1/quotes/shared/:shareToken/decline` | `POST /v1/quotes/shared/decline` |

`resolve` is a pure read and returns 200 rather than the POST-default 201 — the same shape, and the
same reasoning, as the ARES/VIES lookups in `LookupsController`, whose docblock already states the
rule this ADR generalises: the key travels in the body so it stays out of `req.url`, out of browser
history and out of proxy access logs.

### Why a fragment, and not redaction at the scrubber

The obvious cheaper fix is to teach the reduction a list of credential-bearing path prefixes, so
`/nabidka/<seg>` reduces to `/nabidka/[token]`. It was considered and **rejected on two grounds**.

First, it is partial while reading as complete. It closes the browser Sentry and PostHog sinks and
leaves the api access log and the OTel span untouched, because those are different code paths that
have never heard of the list. A fix that looks done and is half-done is worse than an open finding.

Second, it is an **enumeration**, which is precisely the shape ADR 1030 inverted away from. The
whole point of replacing the 1011→1025 lineage was to stop maintaining a list of things that must be
remembered at each new sink. A credential-prefix list reintroduces that: a new token route added
later is not covered until somebody remembers, and nothing reddens.

The fragment is different in kind. **No HTTP client ever transmits a fragment** — it is not in the
request line, not in `Referer`. So the leak is closed at every server-side sink simultaneously, by a
property of the protocol rather than by a rule anyone has to apply. And on the client side the same
primitive protects it from the other direction: `safeUrlOrRedact` rebuilds from parser fields and
never reads `hash`, so a fragment cannot survive it into a scrubbed sink even when captured.

The JSON body is a clean carrier by already-pinned code, not by hope: the Sentry init deletes
`event.request.data`, `SENSITIVE_KEYS` covers `token`, pino logs no bodies, and `@fastify/otel`
captures none.

### The recording invariant

There is exactly one sink that defeats both halves at once, and it must be named as a constraint of
this design rather than left as a preference. **`disable_session_recording: true` in
`packages/flags/src/web.tsx` is load-bearing.** A fragment is invisible to the server but fully
visible to an in-page recorder, which captures the address bar and the DOM directly; PostHog's
replay batches also short-circuit `before_send`, so the scrubber never sees them. Enabling replay
would re-open exactly this leak on the one surface where it matters most. It is pinned by a test
whose comment says so, and turning it on is a decision about a bearer credential.

## Consequences

**These are the cost, and they are accepted deliberately.**

- **`/nabidka` loses SSR.** The route was an RSC that fetched server-side and streamed the rendered
  document in the first HTML byte. It is now client-only: the buyer gets a skeleton, then the
  document after hydration plus one round trip. On a slow phone that is a visible delay where there
  was none. A skeleton (not a spinner) is the mitigation, because the document is the whole page.
- **The fail-closed 404 becomes a client not-found state.** `notFound()` produced a real HTTP 404 for
  an unknown or withdrawn token; the page is now always HTTP 200 with an in-page "this link does not
  work" state. Anything keying on the status code changes behaviour. (Partially pre-existing: the
  capture harness already recorded that this route soft-404s at 200 on an api blip.) A missing
  fragment, an unknown token and a transient api failure render the **same** state on purpose —
  distinguishing them would make the page an existence oracle for quote tokens.
- **The page is inert without JavaScript.** For a buyer-facing commercial document delivered by
  e-mail this is a real robustness regression, stated here rather than discovered later.
- **A reload has no token.** `replaceState` strips the fragment, so refreshing lands on the
  invalid-link state; the mail is the durable carrier and re-clicking the link is the recovery. A
  second credential store (sessionStorage) would fix this and was rejected — it would put the bearer
  token into a new place to leak from, to solve a problem the mail already solves.
- **The fragment is still in the buyer's hands.** `replaceState` removes it from the address bar and
  the back-stack after load; it does not make the link non-bearer. Forwarding the mail still
  forwards the credential. This ADR reduces server-side and telemetry exposure; it is not
  revocation.
- **Link-rewriting mail gateways are the one untested leg.** Safe Links / Proofpoint / Mimecast
  rewrite the `href`, and a rewriter that drops the fragment produces a dead `/nabidka` with no
  error anywhere. The legs we own are pinned (the `@react-email` `Button` render and the plain-text
  conversion both keep `#<token>`); the leg we do not own is a **manual pre-deploy check** recorded
  in `docs/operations/deploy.md`. It is recorded as owed rather than faked with a green test.
- **A win worth naming:** a server-side link scanner that pre-fetches the mailed URL now receives a
  contentless `/nabidka`. It cannot resolve the quote and cannot burn the buyer's throttle budget.
- `linkPath` on `document_delivery` now means path **plus fragment**. No migration and no schema
  change: the column is `text`, still deliberately not `pii()` (it is a bearer credential, not
  personal data), and the events handler's `${WEB_ORIGIN}${linkPath}` concatenation already produces
  the correct absolute URL, because a fragment is appended to origin+path.
- The throttle budget is unchanged: 10/min per IP, shared across all three handlers, exactly as it
  was when the read was a GET.
- `routes.sharedNabidka` loses its `params`. `Href`/`buildPath` cannot express a fragment and must
  **not** be taught to — a typed fragment slot would invite the next credential into the registry
  and back into every URL sink. The one producer builds the absolute link as a raw string, which is
  the right amount of friction.

**Acceptance.** Three integration cases pin the carrier and red if the path forms are reinstated: no
route accepts a token in the URL (all three old shapes 404 while the quote still resolves the
supported way), a bodyless resolve 422s, and a malformed token returns a byte-identical response to
an unknown one. Six web cases pin the browser half: the fragment resolves and renders, the hash is
stripped from the address bar, the token appears in no request URL and exactly one JSON body, no
fragment fires no request at all, an unknown token renders the same state as no token, and a
percent-encoded fragment round-trips.

## Sources

- [ADR 0089](0089-buyer-public-nabidka-view.md) — the buyer surface, trust boundary and lifecycle
  (transport half superseded here).
- [ADR 1030](1030-url-bearing-values-are-reduced-by-the-parser-or-redacted.md) — the URL primitive
  and the open item this closes; [ADR 1031](1031-the-repair-grew-the-allow-list-and-not-its-callers.md).
- [ADR 0129](0129-document-delivery-by-email.md) — the mail that carries the link.
- [ADR 0133](0133-route-segment-credential-manifest.md) — the deny-by-default guard that stops the
  next credential-bearing route from opting out silently.
- Vault: _A URL scrubber that keeps the pathname is only safe while no credential lives in a path
  segment — a share-token route silently opts out of the guarantee_.
