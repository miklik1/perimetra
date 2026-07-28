# ADR 1034 — The mock session store was two stores, because Next loads the module under two export conditions

**Status:** Accepted (2026-07-27) — skeleton upstream-pay wave W13. Ports the `@repo/api-mocks` half of mercata `7d2ec8d`; the `orgRole` half of that commit is deliberately **not** ported (see "What was not ported, and why"). Mock-mode only: no production request path changes.

## Context

`packages/api-mocks/src/fixtures/session.ts` kept its state in a module-level `const sessions = new Map()` plus a module-level `let lastSession`. That is correct in any runtime that evaluates a module once per process. Next is not such a runtime.

Next resolves the same module under two export conditions in one process: `react-server` (RSC and server components) and plain Node (route handlers — everything served from `apps/web/app/api/*`). Those are two module graphs and therefore two evaluations, so `sessions` was two Maps and `lastSession` two independent bindings. The mock's two entry points land in different graphs by construction: the browser reaches the mock over HTTP through `apps/web/app/api/[...path]/route.ts` → `handleApiRequest`, while a server component reaches the same `handleApiRequest` in-process through `apps/web/lib/server-api.ts`, skipping the network. A session opened by `POST /auth/sign-in/email` over the route handler was therefore invisible to the RSC read of that same session — `GET /v1/me` and `GET /auth/get-session` both resolve the user through `resolveSession`, and in the RSC graph that Map was empty.

In a stamped repo the consequence is total rather than partial. Under mock mode `GET /v1/me` 401s from every server component, the session user comes back null, and **no authed server component has ever worked** — the mock could authenticate the browser and could not authenticate the server that renders for it.

Two properties kept this alive for as long as it lived:

- **The failure is silent where nobody asserts.** An anonymous render is a valid render. The signed-out branch renders, the page is a 200, and nothing throws.
- **No unit test in this package could see it.** Inside ONE module instance a module-level Map behaves perfectly, and every test in this package runs in one instance. The 26 tests here were green throughout, including a dedicated `cookieLess session isolation` suite that exercises `lastSession` directly.

It was measured downstream in mercata — whose `session.ts` is a direct descendant of this file — when a screen finally needed eyes-on verification: the admin console was unreachable under mock mode and the hermetic E2E suite could not drive it at all. In this skeleton the defect is latent only in the sense that no shipped skeleton screen yet depends on an authed server render. The mechanism is identical, the file is nearly identical, and every project stamped from here inherits it.

## Decision

### 1. The store hangs off `globalThis` under a symbol

A `MockSessionStore` interface (`sessions` + `lastSession`) is created once and installed on `globalThis` with `??=`, so whichever module graph evaluates first wins and every later graph adopts the same object. `sessions` may be aliased into a module-level `const` because the Map identity is stable once created; `lastSession` is a rebound value and is read and written through `store` at every site. That asymmetry is the one trap in this file and is commented in place.

This is the same singleton trick, for the same reason, as `packages/api/src/middleware/api-log-store.ts` — which already carried the RSC-vs-route-handler rationale in its header. This ADR's comment mirrors that style deliberately: a reader who finds one should recognise the other. One store per process, shared across module graphs, is also what the real backend's Redis session store (ADR 0033) actually behaves like, so the mock now fails and succeeds where the real thing does.

### 2. The key is `Symbol.for("@repo/api-mocks/session-store")`

Not mercata's `@repo/api-mocks.sessionStore`. The five other `globalThis` keys in this repo — `@repo/flags/registry`, `@repo/flags/server-registry`, `@repo/api/api-log-store`, `@repo/utils/logger-sink`, `@repo/telemetry/registry` — are all package-scope + **slash** + kebab-case path. `Symbol.for` is a global, cross-realm registry keyed by an exact string, so these strings are a small shared namespace with a convention, and one member written in a different dialect is a member nobody will find when grepping for the others.

The stakes are higher here than in a normal project because `pnpm create-project` deliberately does **not** rename the `@repo` scope (ADR 0042). This string is stamped verbatim into every derived repo and can never be tidied up centrally afterwards.

### 3. A regression test that loads the module twice

New: `packages/api-mocks/src/fixtures/session.test.ts`. It re-imports the module after `vi.resetModules()` and asserts the two instances share one store — a session opened through one resolves through the other, the cookie-less `lastSession` fallback crosses instances, and one `resetSessions()` wipes both.

The load-bearing line is `expect(other.createSession).not.toBe(createSession)`. Everything else in the file passes vacuously if the re-import ever hands back the same instance, which would silently degrade this into precisely the naive single-instance test it exists to replace. It is asserted once per case rather than once per file, so a single case cannot pass on a stale registry.

That `vi.resetModules()` genuinely re-evaluates this module was **executed, not inferred** — see the verification table. The idiom was copied from `packages/config/src/env/*.test.ts`, where the module under test reads `process.env` at evaluation time; that establishes re-evaluation happens for a module whose side effect is observable through the environment, which is not the same claim.

### 4. A `details` slot on the mock error producer

Secondary and not this ADR's decision to make: `apiErrorEnvelopeSchema` already carries an optional `details` record, and the sibling W13 slice surfaces it on `@repo/api`'s normalized `ApiError` and on the server's exception filter. The mock producer could not express it — `MockHttpError` had no field and `errorEnvelope(code, message)` had no parameter — so mock mode could not reproduce a details-carrying rejection and the client half would have shipped untestable under this repo's own mock-mode E2E. Both now take an optional `details?: Record<string, unknown>` and `dispatchMockError` threads it through.

`errorEnvelope` **omits** the key rather than emitting `details: undefined`, because an envelope with an explicit-undefined key is indistinguishable from one without it in an in-process assertion but not after `JSON.stringify` — and this package's two transports differ on exactly that (the BFF route handler serialises; the in-process RSC path does not). Emitting the key would make the mock's own two paths disagree about the shape of an error body.

## What was not ported, and why

The W13 order was to port both halves of mercata `7d2ec8d`. The measured answer is that the second half has no upstream counterpart, so porting it would mean inventing one.

mercata's other fix added `orgRole` to its `GET /v1/me` payload, because its `/admin` operator gate reads it. Verified here rather than assumed:

- `orgRole` appears **zero** times in this repo — `grep -rn 'orgRole' packages apps tooling docs` returns nothing. There is no org-membership module and no operator gate to feed.
- `apps/api/src/modules/auth/me.controller.ts` projects exactly four fields (`id`, `email`, `name`, `createdAt`) and its comment states the projection is a deliberate allow-list, precisely so that Better Auth `admin()` plugin fields (`role`, `banned`, `banReason`, `banExpires`) cannot reach the client.
- `packages/api-mocks/src/dispatch.test.ts:100` asserts `Object.keys(meBody).sort()` equals exactly those four keys.

So adding a fabricated `"owner"` to the mock would red the mock/real parity assertion in order to satisfy no consumer, and would push the mock's `/v1/me` out of agreement with the controller it mocks. A skeleton that grows an org-role concept adds it to the controller first and to the mock second; that is a product decision for the project, not a defect in the mock.

## Verification

Every claim below was executed. Nothing is reasoned from the code.

| Property                                               | How it was disarmed / observed                           | Result                                        |
| ------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------- |
| The new test REDs on the unfixed store                 | test written first, run against the module-level Map     | **RED** — 3 failed \| 1 passed (4)            |
| …and GREENs on the `globalThis` store                  | same file, after the fix                                 | **GREEN** — 4 passed (4)                      |
| `vi.resetModules()` really re-evaluates this module    | the `not.toBe` identity case, on the unfixed code        | **passed** — it was the 1 of the 3-failed run |
| …and that assertion is discriminating, not always-true | scratch re-import with `resetModules()` removed          | same function identity — the guard would RED  |
| `details` threads throw → envelope → JSON              | scratch case over `dispatchMockError` + `JSON.stringify` | **GREEN**, both trees                         |
| Absent `details` leaves the body key-for-key unchanged | `Object.keys(res.body)` equals `["message","code"]`      | **GREEN**                                     |
| Nothing else in the package regressed                  | full `@repo/api-mocks` suite, `tsc --noEmit`, `eslint`   | **26 passed (4 files)**, clean, clean         |

The identity-guard rows matter most: the first says the test can fail, the second says it fails for the right reason. A two-instance test whose second instance is the first instance reports nothing at all.

## Consequences

- Mock mode can authenticate a server render. Any authed server component, middleware gate, or hermetic E2E flow that needs one now works where it silently could not before.
- The mock's session lifetime is the **process**, not the module. Reloads in dev that re-evaluate the module no longer log the user out — closer to the real backend, and worth knowing before someone treats a surviving session as a bug.
- `resetSessions()` remains the only reset. Because the store now outlives module evaluation, a test that relied on module re-evaluation to get a clean slate would no longer get one; nothing in either skeleton does, and `dispatch.test.ts` already calls `resetSessions()` in `afterEach`.
- **A repo draining this skeleton** gets the fix by merging the file; there is no migration and no data. The one thing to check is a local override: if a project renamed `@repo` by hand or vendored `session.ts`, the symbol string must stay identical across every copy that must share a store — two spellings of the key are exactly the original bug with extra steps.
- The generalisation, and the reason this is written down rather than just fixed: **a green unit suite says nothing about state that is supposed to be shared across module graphs, because the unit suite is one graph.** Module-level mutable state in any package that Next can resolve under both conditions is a latent version of this defect. The five existing `Symbol.for` keys in this repo are five places where that was already known; this is the sixth, found only because a screen was looked at.

## Sources

- mercata `7d2ec8d` (`feat(admin): build the Doklad detail screen, and fix three defects it uncovered`) — where the defect was measured, on a direct descendant of this file. Read-only; only the `api-mocks` hunks were taken.
- [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) (framework-agnostic mock routes, one source of mock truth for BFF + MSW), [ADR 0033](0033-better-auth.md) (the real session store this mocks), [ADR 0042](0042-template-lifecycle.md) (the `@repo` scope is not renamed on stamp-out).
- `packages/api/src/middleware/api-log-store.ts` — the prior art for the same singleton, and the comment style this one mirrors.
