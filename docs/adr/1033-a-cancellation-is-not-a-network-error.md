# ADR 1033 — A cancellation is not a network error

**Status:** Accepted (2026-07-27) — HQ-ruled default, Martin ratify queued (do-first doctrine). W13 skeleton upstream-pay wave. Landed together with the web-native-skeleton twin, **ADR 1027**. Extends the transport contract owned by [ADR 0012](0012-api-client-factory.md) and [ADR 0030](0030-api-response-envelope-seam.md); does not amend either.

**Provenance.** The defect in Part 1 was found and fixed in **perimetra**, in perimetra's own tree, and was never pushed back up. The skeletons both carried it, so every project stamped from either one inherited it. Perimetra shipped **no test** for its fix — that debt is paid here rather than ported, and the justification below is written from this repo's own mechanism (the telemetry sink, and the rule `retry.ts` already encodes) rather than copied: perimetra's rationale cites a perimetra ADR and a perimetra query, neither of which means anything in a skeleton.

## Context

Every failure out of the middleware chain landed in one catch in `packages/api/src/client/create-api-client.ts`:

```ts
} catch (cause) {
  const message = cause instanceof Error ? cause.message : "Network request failed";
  logger.error("apiFetch network error", { url, cause });
  throw new ApiError({ kind: "network", status: 0, message });
}
```

The catch is correct about the `ApiError` and wrong about the log line, because **not every rejection reaching it is a failure**. An `AbortSignal` firing is the caller cancelling its own request, and the standard query builder makes that the common case rather than an edge one. `packages/api/src/builders/define-endpoints.ts` threads TanStack Query's signal into every generated `queryFn`:

```ts
queryFn: ({ signal }) =>
  client.apiFetch<TData>(url, { signal, parse: config.schema }) as Promise<TData>,
```

and the infinite-query builder does the same at lines 87–89. TanStack Query aborts that signal whenever a query is cancelled — when the last observer unmounts, and when a refetch supersedes an in-flight one. So **an ordinary navigation away from any page with a request still in flight** rejects with `AbortError: signal is aborted without reason`, hits this catch, and is logged at error level.

### Why an error log is not merely noise here

`logger.error` is not console-only. `packages/telemetry/src/sink.ts` bridges the `@repo/utils` logger to telemetry (ADR 0021), and the bridge is installed at boot in both apps (`apps/web/lib/telemetry-boot.ts:42`, `apps/mobile/lib/telemetry-boot.ts:43`):

```ts
if (level === "error") target.captureMessage(message, "error", extra);
```

Every logged cancellation is therefore an **error-level Sentry event**. Because the sink captures the message rather than the exception, all of them group under a single `apiFetch network error` issue whose event count climbs with user navigation and has no relationship to anything being wrong. That issue then dominates the error budget, the alerting, and the release-health signal — and it drowns the genuine transport failures that share the same message, which is the part that actually costs something. Suppressing the log is not a cosmetic change; it is the difference between the error stream measuring failures and measuring page views.

### The rule already existed, one directory over

`packages/api/src/middleware/retry.ts` has always refused to replay an abort:

```ts
function isAbort(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}
…
if (idempotent && attempt < retries && !isAbort(cause)) {
```

That is the same judgement — _an abort is the caller's own signal, never a transport fault_ — applied to the retry half of the transport and missing from the logging half. One rule, encoded in one of the two places that need it. This is the shape the skeletons keep producing and keep paying for: a rule closed at one sink and left open at another.

## Decision

**Gate the network-error log on the cause not being an abort, and keep throwing.**

```ts
if (!isAbortError(cause)) logger.error("apiFetch network error", { url, cause });
throw new ApiError({ kind: "network", status: 0, message });
```

The throw is deliberately untouched. The rejection is how TanStack Query settles a cancelled query and how any hand-written caller unwinds its own `await`; swallowing it, or resolving `undefined` instead, would change control flow at every call site in every derived repo to fix a logging problem. **Only the log line — and the telemetry event behind it — is suppressed.**

**The predicate is exported from `create-api-client.ts` as `isAbortError`, and `retry.ts` imports it.** After the fix the same test would otherwise exist twice in one package, which is precisely how the two halves drift apart again. `retry.ts` already imports `parseRetryAfter` from `create-api-client.ts`, so the edge exists and costs nothing.

**It must not live in `errors.ts`,** which is where a classification helper would otherwise belong. `errors.ts` imports `ApiError` from `create-api-client.ts`; putting `isAbortError` there and importing it back would make the two modules mutually dependent. The direction is fixed by the existing import, not by taste.

### The predicate matches on `name`, and the test fixture is load-bearing

```ts
export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}
```

Not `instanceof DOMException`: React Native ships no `DOMException` at all, so an `instanceof` test is not portable across the runtimes this client targets. This is why `retry.ts`'s `sleep` already **mints** its aborts as `Object.assign(new Error("The operation was aborted."), { name: "AbortError" })`, and the comment there now says so explicitly.

**A test must build its abort the same way, and this was measured, not assumed.** Under this repo's Vitest jsdom environment (vitest 4.1.8, jsdom 29.1.1), with a probe run inside the real suite:

| fixture                                                        | `instanceof Error` | `.name`        |
| -------------------------------------------------------------- | ------------------ | -------------- |
| `new DOMException("The operation was aborted.", "AbortError")` | **false**          | `"AbortError"` |
| `Object.assign(new Error("…"), { name: "AbortError" })`        | **true**           | `"AbortError"` |

jsdom's `DOMException` is cross-realm, so `instanceof Error` is false there while a real browser says true. A `DOMException` fixture would therefore make the test **measure the environment instead of the code** — green or red for reasons that have nothing to do with `isAbortError`, and inverted the day the environment changes. The new test uses the portable shape and says why at the fixture.

This also explains why the pre-existing `"normalizes an aborted request to a network ApiError"` test could not simply be extended: its `DOMException` fixture is not recognised as an abort under jsdom, so it exercises the non-abort path. It is left exactly as it was — it pins the `ApiError` normalisation, which is still correct for any rejection — and the new test sits beside it.

### The guard is a pair, not a single assertion

The new test asserts the request still **rejects** with `{ kind: "network", status: 0 }` **and** that `console.error` was not called. The existing `"normalizes a fetch rejection to a network ApiError and logs"` test asserts the opposite direction on a genuine offline error: it _is_ logged. Both directions or neither — a one-sided assertion here is satisfied by a client that logs nothing at all.

## Also landed: the client half of the `details` forward

A second, unrelated defect in the same file, fixed in the same change because it touches the same lines. It shares no rationale with the decision above and is recorded separately here rather than given its own number.

The error contract is `{ message, code?, details?, errors? }`, declared in `packages/validators/src/api-error.ts` and already **parsed** by the client against `apiErrorEnvelopeSchema`. The client then discarded `details` one line from where it was needed:

```ts
code: mapped?.code ?? (envelope?.success ? envelope.data.code : undefined),
body: data,
fieldErrors: mapped?.fieldErrors ?? (envelope?.success ? envelope.data.errors : undefined),
```

`message`, `code` and `errors` were forwarded; `details` was parsed and dropped. A typed rejection therefore reached application code without the structured context the contract exists to carry — the conflicting id on a `409`, the remaining budget on a `429` — pushing call sites back onto `error.body` and string-matching, which is the untyped path the `ApiError` normalisation was built to remove.

**Decision:** `ApiError` gains `readonly details?: Record<string, unknown>` (field and constructor argument), `ResponseEnvelopeConfig.mapError`'s return type gains `details?: Record<string, unknown>`, and the throw site populates it with the same precedence every other mapped field already uses:

```ts
details: mapped?.details ?? (envelope?.success ? envelope.data.details : undefined),
```

The ADR 0030 seam wins over the default schema, exactly as it does for `message`/`code`/`fieldErrors` — a backend with a foreign error envelope must be able to **supply** `details`, not merely fall back to it. Both arms are pinned by the new test, and each was disarmed independently to confirm it.

**`errorContext()` in `errors.ts` is deliberately left alone.** It already excludes `body` on the grounds that a response body may carry user input, and `details` has exactly the same exposure — it is server-authored, but nothing stops a server from echoing a submitted value into it. Putting `details` into telemetry context is a separate decision with a PII weight on it, and this ADR does not make it. That reasoning is recorded at the field's definition so it survives the next reader who notices the omission and assumes it was an oversight.

**The server half ships separately.** This is the client end of the forward only. The corresponding backend change — the exception envelope actually emitting `details` — is the sibling [ADR 1035](1035-the-error-envelope-declared-details-and-never-sent-it.md), landing in the same wave. Neither half is useful alone: without 1035 nothing populates the field, and without this ADR nothing delivers it. The web-native twin (its ADR 1027) carries this same client half and no server half at all, because that tree has no `apps/api`: there, what fills `details` is whatever backend the derived project drains onto.

## Verification

All output below was executed, not asserted.

**Red before.** With the tests added and the source unfixed, in both trees:

```
FAIL  src/client/create-api-client.test.ts > apiFetch cancellation > does not log a cancellation as a network error
AssertionError: expected "error" to not be called at all, but actually been called 1 times
  1st error call:
    Array [ "apiFetch network error",
      Object { "cause": [AbortError: The operation was aborted.], "url": "https://api.test/things" } ]

FAIL  src/client/create-api-client.test.ts > apiFetch http errors > forwards the envelope's details …
AssertionError: expected undefined to deeply equal { conflictingId: 'abc' }
```

**Green after.** `pnpm --filter @repo/api exec vitest run` — 11 files, 72 tests passed (fullstack); 11 files, 79 tests passed (web-native). `tsc --noEmit` and `eslint --max-warnings 0` clean on the changed files in both trees.

**Disarmed, per guard, in both trees.** Each fix was reverted individually and the matching test — and only that test — went red:

| disarmed                                                    | fullstack            | web-native           |
| ----------------------------------------------------------- | -------------------- | -------------------- |
| the `!isAbortError(cause)` gate                             | 1 failed / 31 passed | 1 failed / 32 passed |
| the `details:` line at the throw site                       | 1 failed / 31 passed | 1 failed / 32 passed |
| only the `mapped?.details ??` half (envelope fallback kept) | 1 failed / 31 passed | —                    |

The third row matters: without it, the `details` test could have been satisfied by the envelope path alone while the `mapError` precedence went unpinned.

## Consequences

- **Sentry error volume drops in every derived repo, immediately and by a lot.** A project that has been alerting or budgeting on the `apiFetch network error` issue will see a step change. That is the fix working; the events it stops sending were never failures.
- **Genuine transport failures are still logged, unchanged.** Only a rejection whose `name` is `AbortError` is suppressed, and only the log — the `ApiError` is thrown identically either way, so nothing downstream of the transport can tell the difference.
- **`isAbortError` is package-internal.** It is exported from `create-api-client.ts` because `retry.ts` needs it, but `packages/api/src/index.ts` uses an explicit named-export list rather than `export *`, so it is **not** part of `@repo/api`'s public surface. If application code should be able to classify a cancellation — telling "the user navigated away" apart from "the network is down" in a UI — that export has to be added deliberately.
- **`ApiError` gains an optional field.** Nothing breaks: existing constructions omit it and get `undefined`. Repos that had been reaching into `error.body` for the same data can move to `error.details`, and should, but are not forced to.
- **`details` is not in telemetry context and must not be added there casually.** It can carry user input. A repo that wants it in Sentry owes itself the PII review that decision needs.
- **A repo already stamped from either skeleton does not get any of this by existing.** Both changes are invisible from the outside — the cancellation defect looks like ordinary error volume, and the dropped `details` looks like a backend that does not send them. Neither will announce itself; both have to be taken deliberately.

## Sources

- perimetra — the origin of the Part 1 fix, in its own tree, with no upstream push and no test. This ADR is the upstream payment, not a port.
- `packages/api/src/builders/define-endpoints.ts:44-45, 87-89` — the signal threading that makes cancellation the common case rather than an edge one.
- `packages/telemetry/src/sink.ts:22` and `apps/{web,mobile}/lib/telemetry-boot.ts:42-43` — the `logger.error` → `captureMessage(…, "error")` path, and its boot wiring.
- `packages/api/src/middleware/retry.ts` — the pre-existing `isAbort` rule the log gate now shares, and the portable-`AbortError` convention its `sleep` already followed.
- `packages/validators/src/api-error.ts:11` — `details` in the declared contract, parsed by the client since before this change.
- Realm probe run inside the real Vitest jsdom suite in both trees on 2026-07-27 (vitest 4.1.8, jsdom 29.1.1), producing the `instanceof Error` table above.
