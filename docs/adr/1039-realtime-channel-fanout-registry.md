# ADR 1039 — A shared channel fans out: one vendor subscription, N refcounted consumers

**Status:** Accepted (2026-07-27). **Supersedes the duplicate-subscribe clause of [ADR 0029](0029-realtime-package-centrifugo.md)** — the rule that "one logical subscription per channel; duplicate `subscribe` throws (fan-out belongs above the seam)". Everything else in ADR 0029 — the seam itself, the recovery model, the no-op default and the mock, the injected token, the DAG — stands unchanged. ADR 0029 is left as written and carries a forward pointer.

## Context

`@repo/realtime`'s adapters keyed exactly one subscription per channel in a `Map<string, Subscription>` and threw `Already subscribed to channel "<x>"` on a second call. The React hook `useChannel` caught that throw and routed it to the caller's `onError`, or, with no `onError`, to a `console.warn`.

Both halves were written for good reasons, and together they produced a silent failure.

The throw is the right guard for a **transport** subscription: you genuinely cannot open the same Centrifugo subscription twice, and doing so is a programming error worth stopping. The catch is the right guard for the **StrictMode race** it was written for: React 19 mounts, runs cleanup, and mounts again, and a duplicate subscribe during that window is benign, not a bug — letting it escape would tear down the nearest error boundary on every dev-mode mount.

What neither anticipated is that a channel can have **more than one legitimate consumer**. A broadcast channel is the normal case, not an edge case: `org:<id>` carries organisation-wide events that several unrelated components want. When a second component subscribed, the adapter threw, the hook caught, and that component silently received **no subscription at all** — no error, no boundary, no failing test. Its push-driven invalidation simply never ran and it degraded to focus-refetch, which is precisely the graceful fallback the hook documents, so nothing looked wrong.

This was found downstream in `perimetra`, where `useNavCounts` and `useDashboardSummary` both sit on `org:<id>` on `/`. One won; the other's realtime updates never arrived. It surfaced only as a stray browser-console warning in a Playwright run — the weakest possible signal for a whole-feature outage.

The generalisation is the reusable part: **a guard placed on the wrong noun stays green while the thing it guards is broken.** `subscribe` was doing two jobs — opening a transport subscription and registering a consumer — and the uniqueness rule that is correct for the first is wrong for the second. Splitting the nouns is the fix; narrowing the catch, or teaching apps to coordinate channel ownership, would leave the same class alive one level up.

## Decision

**Separate the transport subscription from the consumer registration.** One internal fan-out registry, `packages/realtime/src/fanout.ts`, owns consumer bookkeeping; adapters own only the vendor seam.

### Placement

ONE implementation, composed by every adapter — `centrifuge.ts`, `mock.ts` **and** `noop.ts`. It is not on the package's `exports` map, so the ADR 0011 deep-import ban keeps it private, and `knip` is satisfied because the three adapters import it.

Two alternatives were considered and rejected:

- **Per-adapter bespoke fan-out.** This is how the mock drifts from the real adapter and then lies to every downstream test that uses it. Rejected outright; the conformance suite below exists to make the drift impossible even by accident.
- **An opt-in `withFanout(client)` wrapper applied at the composition root.** Forgetting to apply it is a silent regression — the exact failure mode this ADR is repairing. A correctness rule that can be forgotten is not a rule.

The no-op is included deliberately. Exempting it would be a lie by exemption: app code written and tested against the keyless default would learn habits (release twice, ignore refcounts) that the real adapter punishes in production.

### Data structure

One entry per channel, holding the single vendor handle, a `Map<number, handlers>` keyed by an **integer consumer id**, the `since` the subscription was opened with, the latest position seen, the last real subscribed context (for replay to late joiners), and a pending-teardown canceller. `consumers.size` **is** the refcount.

The consumer map is keyed by an integer and not by a `Set` of handler objects for a specific reason: two consumers may legitimately pass the **same** handlers object — a shared module constant, a memoised callback bag — and a `Set` would dedupe them and drop one silently. That is this ADR's own bug class, re-created one level down.

The adapter seam is `open(channel, since, sink) -> handle` and `close(channel, handle)`, with a sink of `publication` / `subscribed` / `error`. The registry stamps `channel` and `origin` onto every context on the way out; an adapter cannot know whether a given consumer opened or joined, so it is never asked.

Fan-out iterates a **snapshot** of the consumer values. A handler may subscribe or unsubscribe synchronously during delivery, and a consumer dropped mid-delivery still receives the message already in flight (and none after).

**Ordering rule, found by prototype failure and therefore encoded as both a comment and a test:** the first consumer is inserted into the entry **before** `adapter.open()` is called. The mock delivers `subscribed` synchronously from `open` when already connected, so a consumer registered afterwards would miss its own `onSubscribed`.

### Refcount and teardown

`subscribe`: no entry → create, insert the consumer, open. Entry exists → cancel any pending teardown, insert, and replay a synthetic `onSubscribed` if a real one has already been seen.

`unsubscribe`: a per-handle `released` boolean; a second call throws. The first call deletes this consumer id. If consumers remain, the vendor subscription is untouched. If none remain, teardown is **scheduled**, never run inline, and the scheduled callback re-checks that the count is still zero.

**The grace window is one microtask** — `Promise.resolve().then(...)`. Not `queueMicrotask`, because `Promise.resolve` is universally available including on Hermes/React Native. Not `setTimeout`, because a microtask keeps the mock's tests deterministic behind a single `await`.

The deferral is measured, not aesthetic. React 19 runs **all** effect cleanups and then **all** effect setups inside one synchronous flush, so a channel whose only consumer is remounted (StrictMode) or swapped for an identical one drops to zero consumers and returns in the same tick. Immediate teardown would close and reopen the vendor subscription every time: the adapter loses its tracked `epoch` bookkeeping, and in `fullstack-skeleton`'s web adapter each reopen fires a fresh `POST /v1/realtime/subscribe-token`.

`disconnect()` resets the registry: every channel closes now, every pending teardown is cancelled, and outstanding handles become inert.

### Stream position on a second subscribe

A vendor subscription's position is fixed when it opens, so:

- A second subscribe **with no `since`** joins, and gets a synthetic subscribed context marked as a join, carrying the entry's current position and `wasRecovering: false, recovered: false`. That is honest — the joiner attempted no recovery — and it keeps every existing `wasRecovering && !recovered → mark stale` app check correct.
- A second subscribe **with a `since` that differs** from the open one while at least one consumer is live **throws**. Two live consumers cannot disagree about one stream position, and that is genuinely unmodellable at this seam. The throw is **mount-order dependent**; see "What is NOT modelled" below, where that asymmetry is recorded.
- A `since` deep-equal to the open one **joins** without throwing (deep equality, not identity — a caller re-reads its stored position each render).
- A `since` arriving when the entry has **zero live consumers** (pending teardown) reaps the entry and re-opens **only when that `since` differs** from the one the entry was opened with. Nobody is left to disagree with it, so re-opening is honest, and the cost is real: such a remount opens twice, which is correct — the consumer asked for history from a specific position and gets it.

  A `since` that **deep-equals** `openedSince` must instead fall through and **join** the pending entry, cancelling its teardown exactly like the no-since path. Reaping on _any_ `since` defeated the grace window for every since-bearing consumer: measured through the real `useChannel` under `<StrictMode>` as `openCount` 2 with `since` against 1 without, and on the Centrifugo adapter as two `newSubscription` calls and two subscription-token mints for one channel — the exact cost the grace window exists to avoid, reintroduced for precisely the consumers that need history most.

  An earlier draft of this ADR justified the unconditional reap as "what stops a StrictMode remount of a since-bearing sole consumer from false-throwing against its own draining subscription". **That justification was false**: the since-conflict throw fires only on a position that _differs_, so a deep-equal remount could never have reached it. The rule was doing nothing but churn.

### The tracked position only moves forward

The registry's tracked position is replayed to every late joiner, and `subscribed` fires on **every reconnect** — so an adapter that reports the position it was OPENED with, rather than the one its stream has reached, drags the registry backwards once per reconnect, and the rewind escapes that adapter's own consumers to reach the next one that joins.

The mock did exactly this (measured: a channel at offset 9 reported back to 4 on reconnect, and a second consumer then replayed from 4). Both halves are fixed, because they are different defects:

- **The honest half — `mock.ts`.** The mock tracks where its stream has actually reached (`since` at open, then every position it emits) and reports that on each (re)connect. This is what the Centrifugo adapter does: `ctx.streamPosition` is the server's current position, not the one the subscription was created with. The mock is what every downstream app tests against, so a mock that diverges from the shipped adapter lies to every one of those tests — which is the whole reason the conformance table exists, and it now pins this.
- **The defensive half — `fanout.ts`.** Within one epoch, a lower offset is refused. A **different** epoch always wins: Centrifugo mints a new epoch when a channel's history is recreated and offsets restart from zero, so the numbers are not comparable and a lower offset there is a new stream, not a rewind.

The guard is scoped to what the registry **tracks and replays**. The `SubscribedContext` handed to consumers still carries the adapter's own report verbatim — that is the adapter's statement about its own (re)subscribe, and rewriting it would hide an adapter defect instead of surfacing it to the one consumer positioned to notice.

### Signatures

`SubscribedContext` gains a **required** discriminator, `origin: "opened" | "joined"`. Required on purpose: it is the compile-time forcing function that makes every adapter written outside this package fail `pnpm check-types` until it is updated. That is the mechanism by which this change lands in **all** adapters or does not build at all — measured, not assumed (see Verification).

A new exported `RealtimeContractError` carries `code` (`"since-conflict" | "double-release"`) and `channel`, so callers and tests branch on the code rather than on a message regex. The old tests matched `/Already subscribed/`; a message is free to improve, a code is API.

`useChannel` **deletes the try/catch entirely** — it is not narrowed. After fan-out, "already subscribed" is unreachable for the legitimate case, and everything `subscribe` can still throw is a programming error that must reach the nearest error boundary. The public signature is unchanged.

The mock redefines `activeChannels()` as "channels with at least one live consumer" (so existing tests keep passing) and adds `openChannels()`, `consumerCount(channel)` and `openCount(channel)`. `openCount` is not optional garnish: without it the grace window is unobservable, and an unobservable rule is not a rule.

**`openCount` is counted in `mock.ts`, not in the registry.** To answer the question it exists for — did this channel open once across a StrictMode double-mount — the counter has to survive both teardown and `reset()`, which makes it a map nothing ever clears: one retained entry per distinct channel name, for the life of the client. In a test double, bounded by one test, that is free. In the shared registry it made **every** client retain an entry per channel ever subscribed (measured: 50,000 subscribe/unsubscribe cycles leave `openChannels()` empty and all 50,000 names retained) — and for the per-entity channels these repos model (`user:<id>`, `project:<id>`) that is one permanent entry per entity a session ever viewed, with **no production reader at all**: neither `centrifuge.ts` nor `noop.ts` ever exposed it. The registry now derives every accessor it has from the channel map that reaping empties, and a test pins that surface so re-adding a cumulative counter there has to be argued again.

### The app-side adapter collapses into the package adapter

`apps/web/lib/realtime/centrifuge-client.ts` was a near-copy of the package adapter, carrying one addition the package did not model: a per-channel `getSubscriptionToken` (the SDK's subscription-level `getToken`), needed because the local Centrifugo namespaces (`user`, `org`) refuse a client-side subscribe without a subscription JWT, which the API mints at `POST /v1/realtime/subscribe-token`.

A near-copy cannot be fixed in place here, and that is structural rather than stylistic: **the fan-out registry is internal**, so an app-side adapter cannot import it and therefore cannot have fan-out at all. Any hand-rolled `RealtimeClient` in app code silently reintroduces the exact defect this ADR repairs.

So `getSubscriptionToken` moves **upstream** into `CentrifugeRealtimeConfig` (optional; omitted for open namespaces, and the SDK option is omitted entirely when the app supplies no hook), and the app file becomes the app's own config shape mapped onto the package's. `createWebCentrifugeRealtime` keeps its name and its config shape, so `apps/web/app/realtime-provider.tsx` is untouched.

The per-channel token stays correct for free, and that is the fan-out property doing the work: there is still exactly ONE vendor subscription per channel however many components subscribe, so a subscription JWT is minted once per channel, not once per consumer — and the deferred teardown stops a StrictMode remount from firing a fresh mint on every mount.

### What is NOT modelled, and how each fails loud

1. **Two live consumers with different `since`** → throws `since-conflict`, with a message naming both positions.

   **This throw is MOUNT-ORDER dependent, and that asymmetry is part of the contract.** A consumer with no `since` joins whatever position the channel already has, so:
   - `[no-since, since]` → **throws.** The channel is open on the live stream; the second consumer asks to resume from somewhere else.
   - `[since, no-since]` → **silent.** The channel is open at the requested position; the second consumer joins it.

   Two components sharing a broadcast channel is the pattern this package advertises as normal, so a pair that works today crashes tomorrow when one of them starts passing `since` — and whether it crashes depends on which component mounts first, which is a property of the tree, not of either component. Nothing about that is guessable from the throw itself, so the message names it and states the one-line fix (**subscribe the since-bearing consumer first**, or give it its own channel). Both orders are pinned in the conformance table and again at the hook layer, so the asymmetry is visible in the suite rather than discovered in production.

   The throw stays. It is the design bar — an unmodelled case must fail loud — and re-adding a `catch` in `useChannel` would restore the silent-failure class this ADR exists to remove. What was missing was not a catch but the documentation of the asymmetry.

2. **Double release of one handle** → throws `double-release`.
3. **Per-consumer history replay or server-side filtering** → not modelled. Case 1's throw is the door it hits, and that message points at the remedy: give this consumer its own channel.
4. **Cross-client fan-out** → out of scope by construction. Each client owns its own registry, and the app's provider already guarantees exactly one client.
5. **A consumer mutating the shared publication envelope** → documented as forbidden, **not enforced**. Freezing every publication on a hot socket is a real cost. A documented gap, not a silent one.
6. **A consumer handler that throws** → propagates, aborting delivery to the consumers after it in the snapshot. Found while building, and recorded here rather than papered over: catching per consumer would isolate them but swallow real errors, which is the wrong trade for a package whose whole defect history is silent failure. Handlers must not throw; when one does, it is loud.

**One case is deliberately silent: `unsubscribe()` after `disconnect()`.** React runs the provider's `disconnect` **before** its children's `unsubscribe`, so making that loud would throw on every app teardown. This is exactly why double release is tracked by a per-handle flag and **not** by "the entry is missing" — the flag distinguishes the two.

## Consequences

- A second legitimate consumer of a shared channel **works**: both receive every message, over one vendor subscription. That is the bar this ADR was measured against.
- Every unmodelled case **fails loud** — a typed throw with a code, not a degradation.
- The mock cannot drift from the shipped adapters. The behaviour table is written once in `src/fanout-conformance.ts` and run against the mock, the no-op and the Centrifugo adapter (over the SDK fake). Rules the no-op has no vendor side for are **skipped and reported as skipped**, never faked into a vacuous pass.
- A vendor subscription now outlives a sole consumer by one microtask. Tests that assert teardown must cross that window with `await Promise.resolve()`; the existing centrifuge test that read the removed-subscription list synchronously was fixed, not deleted.
- The React hook can no longer hide a `subscribe` failure. That is the point, and it needs its own guard — the disarm test — because a caught throw is indistinguishable from a working subscription until some message fails to arrive. The cost is that a `since-conflict` reaches an error boundary, and whether it is thrown at all depends on mount order; that is documented above and pinned in both orders rather than softened.
- **ADR 0029's claim that "no skeleton app wires it yet" is stale in this repo, and was already stale before this ADR.** Three files wire realtime today: `apps/web/app/realtime-provider.tsx` (the shared client), `apps/web/lib/realtime/centrifuge-client.ts` (the adapter wiring) and `apps/web/app/projects/projects-live-badge.tsx` (a `useChannel` consumer). Recording it here rather than editing ADR 0029 keeps the supersede-don't-rewrite rule; the sibling `web-native-skeleton`, where the claim is still true, records the mirror in its ADR 1032.

## What a draining repo must do

1. **`SubscribedContext.origin` is required.** Any hand-rolled `RealtimeClient` adapter, and any test double that constructs a `SubscribedContext`, will fail `check-types` until it sets it. Set `"opened"` where the vendor really (re)subscribed. If your adapter has its own channel map and its own duplicate throw, the correct fix is to delete that map and compose `createCentrifugeRealtime` — the fan-out registry is internal and cannot be imported, so a hand-rolled adapter cannot have fan-out.
2. **Delete any app-side workaround for the duplicate-subscribe throw**: a "channel owner" convention, a shared-subscription singleton, a `try/catch` around `subscribe`, a hook that refuses to mount twice. All of them now suppress a real error.
3. **Audit every `catch` around `subscribe`.** After this change a throw means a genuine contract violation; catching it re-creates the original defect.
4. **Search for components that quietly gave up a shared channel.** The symptom is a component that "works" via focus-refetch and never via push. In `perimetra` that is `useNavCounts` / `useDashboardSummary` on `org:<id>`; adopt this change before assuming a realtime feature is fine because nothing is red.
5. **Tests that assert channel teardown need a microtask flush.** `await Promise.resolve()` after the last `unsubscribe()`.
6. **Branch on `RealtimeContractError.code`,** not on `/Already subscribed/` or any other message text.
7. **On any channel with more than one consumer, subscribe the since-bearing one FIRST.** `[no-since, since]` throws and `[since, no-since]` does not, so adding a `since` to one component of a shared channel can crash the tree depending on where it sits in it. If the ordering is not something you control, that consumer needs its own channel.
8. **A hand-rolled adapter must report the position its stream has REACHED** on every `subscribed`, not the one it was opened with. The registry replays its tracked position to late joiners and refuses a backwards move within an epoch, so a stale report is now merely ignored rather than propagated — but it still makes that adapter's own `onSubscribed` contexts wrong.

## Verification

The design claims above were each mutated against the landed code and the failing tests recorded, so that no claim rests on an untested guard (`pnpm --filter @repo/realtime exec vitest run`, baseline **115 passed / 20 skipped**):

| Mutation                                                                | Tests red     |
| ----------------------------------------------------------------------- | ------------- |
| restore `useChannel`'s try/catch                                        | 2             |
| delete refcounting (close on any release, grace window kept)            | 8             |
| delete the microtask grace window                                       | 18            |
| iterate consumers live instead of a snapshot                            | 2             |
| move the first consumer's insert after `open()`                         | 8             |
| make `origin` optional                                                  | 0 (see below) |
| mock reports its `since` instead of the position its stream reached     | 1             |
| drop the registry's position-monotonicity rule                          | 1             |
| both position halves at once (the state this ADR's first draft shipped) | 3             |
| reap a draining entry on ANY `since`, not only a differing one          | 3             |
| move the cumulative open counter back into the registry                 | 1             |
| drop the mount-order text from the since-conflict message               | 4             |

Two rows carry the weight.

**The try/catch row.** Restoring it reds the disarm test in `react.test.tsx` — the one test written for it, because a caught throw is indistinguishable from a working subscription until some message fails to arrive — and now also the mount-order test, which asserts the throw reaches the caller in one of the two orders. Two guards, not one.

**The position rows.** Each half is disarmed alone (1 red each, and they red on _different_ tests: the mock's own honesty test versus the registry's monotonicity test). Disarming both together reds 3, and the third is the one that matters — the conformance table's late-joiner assertion, failing on the **mock arm while the Centrifugo arm stays green**. That is the drift the conformance table exists to catch, caught.

The `origin` row is measured in the other direction, because requiredness is a compile-time gate rather than a runtime one. With the field required and the app adapter still un-migrated, `pnpm --filter web exec tsc --noEmit` failed in exactly **one file** — `apps/web/lib/realtime/centrifuge-client.ts(98,31)`, "Property 'origin' is missing … but required in type 'SubscribedContext'" — and that is the whole mechanism: an out-of-package adapter cannot be left behind, because the build stops. Once that adapter composes the package's (above), it constructs no `SubscribedContext` of its own, so relaxing the field reds nothing here any more; the gate now protects the next hand-rolled adapter, in this repo or in a derived one.

## Sources

- `packages/realtime/src/fanout.ts` (the registry), `src/fanout-conformance.ts` (the shared behaviour table), `src/fanout.test.ts`, `apps/web/lib/realtime/centrifuge-client.ts` (the collapsed app adapter).
- ADR 0029 (the seam this amends), ADR 0011 (the deep-import ban that keeps the registry private), ADR 1000 (the ≥1000 numbering band this ADR is issued under).
- React 19 effect ordering (all cleanups, then all setups, in one synchronous flush) — the measured reason teardown is deferred.
