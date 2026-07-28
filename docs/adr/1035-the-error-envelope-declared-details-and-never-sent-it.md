# ADR 1035 — The error envelope declared `details` and never sent it; the slot is now forwarded, and it is exactly one slot

**Status:** Accepted (2026-07-27) — upstream port of a defect found in a derived product (perimetra `d70272f`). Backend behaviour change: typed rejections now reach clients with their context, and only when their producer says so. The client half of the same seam ships in ADR 1033.

**The rule in one line:** `details` reaches the wire only from a body built by `errorEnvelope()`. A third-party library's object body does not qualify — that is not a special case for `@nestjs/terminus`, it is the reason the rule is an opt-in and not a shape check.

## Context

The API error contract is `{ message, code?, details?, errors? }`. It is declared once, in `@repo/validators`' `apiErrorEnvelopeSchema`, and narrowed on the frontend by the `ApiError` taxonomy. It has exactly one producer: `GlobalExceptionFilter`, which builds the response object field by field off an `HttpException`'s body.

It copied `message`, it copied `code`, it copied `errors` — and it never copied `details`. So for the life of this skeleton, and of every repo stamped from it, a service that threw

```ts
throw new ConflictException({
  message: "…",
  code: "quote_superseded",
  details: { supersededById },
});
```

put a client-actionable payload on the wire that the client never received. The client got `{ message, code }` and nothing else.

The reason this survived is worth stating precisely, because it is the reusable part. **Every half of the seam is correct in isolation.** The service throws a well-shaped body. The schema declares the field. The frontend narrows on it. And — the load-bearing detail — because `details` is OPTIONAL in the schema, a parse of the STRIPPED body still succeeds. Nothing throws, nothing logs, no status changes. There is no failure to observe anywhere except in a browser, looking at a branch that never renders.

In perimetra that branch was a whole `IssueList` in the issue panel: code-reviewed, type-checked, and unit-tested against a hand-built error object. The one thing never done was driving it from a real API rejection — and a real API rejection was the only thing that could have shown the field missing.

The second reason it survived: **`toMatchObject` cannot see a dropped field.** Every partial-match assertion over an error body stayed green through the entire defect, by construction. A test that asserts a subset of the envelope is not testing the envelope.

Two aggravating facts about this repo specifically, measured rather than assumed:

- `grep -rn "details:" apps/api/src --include='*.ts'` returned **zero** throws carrying `details` (the two hits are the health controller's unrelated readiness payload). Nothing in the skeleton exercised the slot, so the omission had nothing to break.
- The `pnpm gen module` service template throws bare-string `NotFoundException`s and said nothing about where context belongs. Every generated module therefore started life with no reason to use the slot, and no way to learn it existed.

### The asymmetry that decides the rule

The obvious fix — forward `body.details` whenever it is an object — is wrong, and it is worth being precise about why, because the reason generalises past this field.

The filter does not receive bodies only from our own services. It is registered as `APP_FILTER` with a bare `@Catch()`, so it receives **every** exception in the process, including ones thrown by libraries that have never heard of this envelope. `@nestjs/terminus` is exactly that case. Its `HealthCheckService.check()` throws a `ServiceUnavailableException` whose body is `{ status, info, error, details }`, and its `details` is the **readiness map** — one entry per indicator, naming it and saying whether it is up. `GET /health/ready` is `@Public()` and `@SkipThrottle()` (ADR 0044/0045), because orchestrators probe without credentials. Forwarding on shape alone therefore turns a readiness probe into an anonymous topology disclosure:

```
before  503 {"message":"Service Unavailable Exception"}
after   503 {"message":"Service Unavailable Exception",
             "details":{"database":{"status":"down","message":"unreachable"},
                        "redis":{"status":"up"}}}
```

The health controller was already careful — it logs the real driver error server-side and returns only `{ message: "unreachable" }` — and it made no difference, because the leak is not the reason a dependency is down. It is the list of dependencies and which one is failing, and Terminus assembles that list itself.

So the defect is not "Terminus is a special case". It is that **`details` is the one slot whose contents are unbounded, and the filter had no way to tell "a service chose to publish this" from "a library happened to put an object under this key"**. A shape check cannot express that difference. Neither can a narrowing that names `ServiceUnavailableException`, which would restate one library instead of deriving the rule and would be silent about the next one.

## Decision

**1. The filter forwards `details`, in its own slot, on an explicit OPT-IN.** Three rules are load-bearing and all three are pinned by tests:

**(a) OPT-IN, not shape.** `details` is forwarded only when the thrown body carries a module-local `Symbol` that nothing outside `global-exception.filter.ts` can stamp. The only way to stamp it is the exported producer helper:

```ts
throw new ConflictException(
  errorEnvelope({ message: "…", code: "quote_superseded", details: { supersededById } }),
);
```

This is the rule that had to be derived rather than restated. "Was this published deliberately?" is a fact about the producer, and the marker is the only thing in the request path that records it. It generalises: it holds for Terminus, and for every third-party exception that reaches this filter in the future, including the ones nobody has imported yet. The alternatives were weighed and rejected — exempting the health route fixes one URL and leaves every other library's object body forwarded; having the health module throw its own shaped exception fixes one library and forfeits Terminus's own reporting. A symbol also cannot reach the wire: the filter copies fields into a fresh object, and `JSON.stringify` ignores symbol keys.

The cost is real and is accepted: this changes the contract the same wave introduced. `details` on a hand-built body is now dropped, and nothing reddens when it is — the same silence this ADR is about. That is why the producer helper is exported next to the filter (they must never separate), why `IdempotencyInterceptor` was moved onto it in the same change, and why the generator template teaches it.

**(b) A plain object only.** `apiErrorEnvelopeSchema` declares `details` as `record(string, unknown)`, and zod's `record` accepts a **plain** object. `typeof value === "object"` is not that test: a `Date`, a `Map`, an array and every class instance pass it, and then serialize to something that is not a `Record<string, unknown>` on the wire — a `Date` arrives as a JSON string. The guard is a strict SUBSET of the schema on purpose: it may refuse a value the schema would accept (a cross-realm plain object), which only ever drops a field; it may never forward one the schema would reject, which puts an undeclared shape on the wire. `isFieldErrors` was tightened the same way — it accepted `[["required"]]`, since every value of that array IS an array of strings. What the object CONTAINS is free-form and forwarded as-is, arrays included; only the slot itself is constrained.

**(c) ONE SLOT, not a passthrough.** Context thrown anywhere but `details` is dropped, deliberately — opting in publishes the slot, not the body. The tempting generalisation — "spread the thrown body and let the schema sort it out" — is a security regression wearing a convenience costume: it turns every property any internal throw happens to carry into a public API field, arriving by omission, from code that never mentions the wire. A service that parks context outside `details` still loses it, and that is the correct outcome. This is pinned by its own test case, not left to the comment.

**`code` and `errors` are deliberately NOT gated.** They predate this ADR (0014/0030) and every producer in every drained repo throws them bare; gating them would silently drop context that ships today, to close a far smaller hole. They are also structurally narrow — a `string`, and a map of string arrays — so a third-party body has to essentially BE an error envelope to trip them, whereas `details` accepts anything shaped like an object. The audit behind that judgement, and the residual risk it leaves, are in Consequences.

**2. One real producer now carries context, through the opt-in.** `IdempotencyInterceptor`'s two 409s are the natural pair — a client backing off genuinely needs to know which key collided and whether retrying it can ever work. Both now throw `errorEnvelope({ … details: { idempotencyKey, retryable } })`: the bare key the caller sent (never the Redis key, which embeds the user id), and the single boolean that IS the client's decision — `true` for `idempotency_in_flight` (the winner is still running; this key will resolve), `false` for `idempotency_key_reused` (the key is bound to a different body; only a new key can succeed). Their unit assertions were converted from `toMatchObject` on the thrown body to `toEqual` on the whole envelope **as the real filter emits it** — asserting `getResponse()` cannot see a missing opt-in, since the thrown object looks identical either way.

No domain rejection was invented to have a producer. The skeleton has no domain; manufacturing one to test this would have been a fixture pretending to be a feature.

**3. The generator template documents the slot and the opt-in as a comment,** not as a fake throw. `turbo/generators/templates/module/service.ts.hbs` now carries a block comment above the service class showing the `errorEnvelope()` call, naming both silent traps (a `details` built without the helper, and context parked outside the slot), and stating that anything in `details` is public.

**4. The stale claim is corrected.** `apps/api/src/common/api/validation-errors.ts` described the filter as passing `message`/`code`/`errors` through verbatim — a sentence that was accurate about the code and wrong about the contract. It now names all four declared fields and states that field errors belong on `errors`, not `details`. Its test's header and the matching case title were corrected with it. That sentence needs one more qualifier after rule (a): the filter copies the four declared fields, but `details` only from a body built by `errorEnvelope()`. `createValidationException` itself is unaffected — it throws `{message, code, errors}` and never used the slot.

## Verification

Every rule above was disarmed — the fix reverted in place, the suite run, the fix restored — and every one of them reddens. A guard that was not disarmed is a guard that was not verified.

Suite: 33 tests (`global-exception.filter.test.ts` 23, `idempotency.interceptor.test.ts` 10). All green as landed.

| Rule reverted                                                          | Result                        | What went red                                                                       |
| ---------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `details` not forwarded at all (pre-wave state)                        | **RED** — 5 failed, 28 passed | Both filter forwarding cases, the vacuity check, both idempotency envelopes         |
| Opt-in marker gate removed (`isDetails` alone, as first written)       | **RED** — 2 failed, 21 passed | Non-opted-in body forwards; **Terminus publishes `{database, redis}` on the probe** |
| `isDetails` back to `typeof === "object" && !isArray`                  | **RED** — 3 failed, 20 passed | `Date` (arrives as a string), `Map` and `Error` (content does not survive)          |
| `isFieldErrors` back to its pre-fix form                               | **RED** — 1 failed, 22 passed | `errors: [["required"]]` reaches the wire as a JSON array                           |
| Producer's `errorEnvelope()` removed from both 409s                    | **RED** — 2 failed, 8 passed  | Both idempotency envelopes lose `details`                                           |
| Schema declaration text changed (simulating a `@repo/validators` edit) | **RED** — 1 failed, 22 passed | The drift canary                                                                    |

The Terminus case is the important one, and it is driven by the **real library**: the test boots `TerminusModule` through `Test.createTestingModule`, runs the real `HealthCheckService` over the same indicator shape `HealthController.ready()` builds, and feeds the exception Terminus actually throws into the real filter. With the marker removed, the assertion prints the readiness map verbatim. (`common/` keeps no import edge into `modules/`, so the indicators are rebuilt in the test rather than imported; the gap from the reviewer's reproduction is the HTTP transport only.)

## Consequences

- **`details` is now part of the observable API surface** for every route that opts in. Anything put there is public. That is the trade: the slot is forwarded so it can be depended on, which means it must be curated like a response field — no internals, no PII, no stack context.
- **Every third-party exception that can reach the filter was audited**, because rule (a) is only as good as the claim that it covers them all. In `apps/api` as it stands:

  | Source                                              | Body                                                  | What the filter does                                               |
  | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
  | `@nestjs/terminus`                                  | object, `{status, info, error, details}`              | `message` only — `details` is not opted in                         |
  | `@nestjs/throttler` (`ThrottlerException`)          | **string**                                            | string branch — message only                                       |
  | Nest's own router 404 / built-ins                   | object, `{message, error, statusCode}`                | `message` only (`error`/`statusCode` are outside the slot)         |
  | `nestjs-zod` via our `createValidationException`    | object, `{message, code, errors}`                     | all three — our producer, `errors` is ungated by design            |
  | better-auth                                         | mounted as a raw Fastify route with its own try/catch | never reaches this filter as an `HttpException`                    |
  | drizzle / ioredis / BullMQ / AWS SDK / `@fastify/*` | plain `Error`s (not `HttpException`)                  | opaque 500, `{message: "Internal server error", code: "internal"}` |

  The residual risk is stated rather than hidden: a library that threw an `HttpException` whose object body carried a `code: string` would still have that string forwarded as an API error code, and one whose body was structurally `Record<string, string[]>` under `errors` would have that forwarded too. Nothing in the current dependency set does either. If one ever does, the fix is the same marker, applied to that field — and the cost of doing it pre-emptively (silently dropping the `code`/`errors` every drained repo throws bare today) is higher than the hole.

- **The filter's `ErrorEnvelope` type is a knowing restatement of `apiErrorEnvelopeSchema`, not a derivation, and that is a defect with a two-line fix outside this change.** `apps/api` cannot import the schema on either available specifier, measured: the package root maps to `./src/index.ts` whose re-exports are extensionless, which fails `tsc --noEmit` under this app's NodeNext resolution (TS2835) and, as a value import, dies with `ERR_MODULE_NOT_FOUND` in the compiled api at boot while vitest stays green; and `@repo/validators/api-error` type-resolves but is refused by `no-restricted-imports` (ADR 0011) because the package does not publish it. The unlock is a dist-mapped `./api-error` entry in `packages/validators`' `exports` (as `./projects` already has) plus `"!@repo/validators/api-error"` in `tooling/eslint/base.js`. Until then the coupling is held by two things: the producer helper's argument is typed, so `details: new Date()` fails to COMPILE at every throw site (TypeScript gives an interface or class no implicit index signature), and the filter test asserts the schema's declaration text read from disk, so a change to `apiErrorEnvelopeSchema` reddens with instructions.
- **The guard is verified against the wire, not against a second copy of the rule.** The corpus test forwards a value, serializes the emitted body, and requires the result to still be an object and still equal what the producer wrote. That is what a restated predicate cannot check and what the `Date` case broke: `typeof new Date() === "object"` is true, `JSON.stringify` makes it a string, and the client receives something the declared shape does not permit. Predicate-level tests are structurally blind to this; only the serialized value can see it.
- **`toMatchObject` on an error body is now a review smell.** It is how this defect stayed green, and it will hide the next one. Assert error envelopes whole, with `toEqual`.
- **The filter is the only producer of the contract, so it is the only place the contract can be pinned.** It now has a test file for the first time. A change to the envelope that is not reflected there is not a change to the envelope — it is a divergence.
- **A repo draining this skeleton must, after the drain, sweep its own throws twice.** Once for context parked OUTSIDE `details` — any property a service hangs on a thrown body next to `message`/`code` (`status`, `conflicts`, `retryAfter`, anything) was silently dropped before this change and is STILL dropped after it, because rule (c) is deliberate. And once for `details` built without `errorEnvelope()`, which rule (a) now drops. Both are a one-line edit per site, and nothing will tell you to make either: no test reddens, no type complains, and the client's parse succeeds regardless. This is a manual sweep with no automated backstop, which is exactly why it is written down here.
- **The client half is a separate decision and ships as ADR 1033.** The filter putting `details` on the wire does not by itself make it reachable from a component: `@repo/api`'s normalized `ApiError` must surface the field, and `errorContext()` must decide whether it belongs in telemetry. Landing only this half means the payload is present in the HTTP response and still invisible to application code — the two ADRs are a pair, and a repo that ports one should port both.

## Sources

- perimetra `d70272f` (`feat: the ADR 0126 Wave 0 legal + tenancy repairs — Phase A`) — the filter hunks and the test file this ADR ports upstream, minus the domain cases.
- [ADR 1000](1000-adr-numbering-reserved-band.md) — the ≥1000 band this ADR is numbered in.
