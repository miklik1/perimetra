# ADR 1037 — `notFound()` must be reached before the response commits, so no Suspense boundary may sit above a `notFound()` call site

**Status:** Accepted (2026-07-27) — HQ-ruled default, Martin ratify queued.

**Provenance — the cause shipped here, the symptom surfaced downstream.** This skeleton never emitted a soft-404, because it contained **zero** `notFound()` call sites: there was nothing for the defect to break. It nonetheless shipped the whole cause, in one file, to every repo stamped from it. Mercata added `notFound()` call sites — marketing, storefront and legal routes — and inherited an app-wide soft-404 on all of them. The fix and the measurements below are this tree's own, re-measured here from scratch rather than copied.

## Context

`apps/web/app/loading.tsx` existed at the **root** of the App Router tree:

```tsx
export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p>Loading…</p>
    </main>
  );
}
```

A `loading.tsx` is not a decoration. It is sugar for a `<Suspense>` boundary wrapped around its segment — and at the root, that segment is **every route in the application**. The consequence is a streaming-order fact rather than a styling one: React can flush the shell as soon as it hits the boundary, and flushing the shell **sends the HTTP status line**. Everything after that renders into a response whose status is already 200 and can no longer be changed.

`notFound()` sets a 404 by throwing. If it is reached before the response commits, Next catches the throw, renders `app/not-found.tsx`, and answers 404. If it is reached after, the throw still swaps in the 404 UI — but the status is frozen. The app then serves **404 markup under a 200**: a soft-404.

That distinction is invisible in a browser. The page looks exactly like a 404 page. It is only wrong to machines — and to the machines that matter most, because a crawler reading 200 treats the page as real content: it stays in the index, consumes crawl budget, and can surface an error page in search results.

### The measurements

All four were taken in **this** tree, on Next 16.2.9, against a temporary route whose entire body was `notFound()`. Production runs used `next build` + `next start -p 3212` with the proxy bypassed (direct `curl` at the origin); the dev runs used `next dev --port 3212`. Port ownership was proven via `ss -ltnp` plus `/proc/<pid>/cwd` before any response was trusted (the multi-seat trap of [ADR 1012](1012-e2e-web-port-multiseat.md)).

| #   | Condition                                                           | Explicit `notFound()`        | Unknown route |
| --- | ------------------------------------------------------------------- | ---------------------------- | ------------- |
| 1   | root `app/loading.tsx` present (the shipped state)                  | **`HTTP/1.1 200 OK`**        | `404`         |
| 2   | root `app/loading.tsx` deleted                                      | **`HTTP/1.1 404 Not Found`** | `404`         |
| 3   | no root `loading.tsx`, explicit `<Suspense>` above the call site    | **`HTTP/1.1 200 OK`**        | —             |
| 4   | no root `loading.tsx`, `loading.tsx` in the call site's OWN segment | **`HTTP/1.1 200 OK`**        | —             |

Measurement 1 is the defect. Measurement 2 is the fix, isolated to the deletion of a single file — nothing else changed between the two builds. In measurement 1 the body was confirmed to be the real 404 UI (`Stránka nenalezena`, the `cs` catalog string per [ADR 0020](0020-i18n-next-intl-use-intl.md)) served under the 200, which is precisely what makes a soft-404 undetectable by eye.

**Measurement 3 is the one that makes this ADR architectural rather than a bug report.** With no `loading.tsx` anywhere, a plain `<Suspense fallback={…}>` wrapped around a suspending child that calls `notFound()` still answered 200. So the defect is not a Next `loading.tsx` quirk and there is no upstream fix to wait for: it is **inherent to React streaming**. A response that has begun streaming has a status; a suspended segment resolving later cannot retract it. Any boundary above a `notFound()` call site does this, whoever wrote it and whatever convention created it.

Measurement 4 is the corollary that governs where loading UI may now live: a `loading.tsx` soft-404s its **own** segment too, not merely the ones below it. Same route, same server; adding the file flipped 404 → 200 and removing it flipped it back.

### Why the existing test suite was green through all of this

`e2e/not-found.spec.ts` asserted a 404 — and passed, with the bug fully live. It navigated to `/this-route-does-not-exist`, and an unknown path is resolved by the **router**, before any segment renders and therefore before any boundary can flush. Next answers 404 from a code path that `notFound()` never touches.

So the spec that appeared to cover 404 behaviour was structurally incapable of failing on it. Confirmed rather than assumed: in the red run below, `unknown route renders the 404 page` **passed** in the same run where the new assertion failed. This is the sharp edge worth carrying forward — **the unknown-route case and the `notFound()` case share a UI and a status code but not a mechanism, and only the second one can regress.**

## Decision

**`notFound()` must be reached before the response commits. No Suspense boundary — from `loading.tsx`, from an explicit `<Suspense>`, or from anything else — may sit above a `notFound()` call site.**

Four changes implement it:

1. **`apps/web/app/loading.tsx` is deleted.** A root-level loading boundary buys a shell flush on routes that mostly do not need one, and charges for it with the 404 status of every present and future `notFound()` in the application. That is a bad trade at any traffic level, and a worsening one as an app grows the dynamic routes that actually need to 404.

2. **Loading UI moves down to the segments that actually fetch, one boundary per route that pays for one** — `app/(home)/loading.tsx`, `app/projects/loading.tsx`, `app/account/loading.tsx`. Each `page.tsx` awaits a prefetch before it can render anything, so a boundary there is doing real work. The UI is byte-for-byte the previous root file; this is a relocation, not a redesign. Each file carries the constraint it creates: nothing in that subtree may call `notFound()`, and if a `[id]` child that 404s on an unknown record ever lands there, the boundary moves down to the leaf that fetches rather than staying above a call site.

   `/` is the case that needed a device rather than a directory. It has no segment of its own — its page is `app/page.tsx` — so the only file that can give it a boundary is the root `loading.tsx` this ADR deletes. **`app/page.tsx` therefore moves to `app/(home)/page.tsx`.** A route group is a naming device: the parentheses are stripped from the URL, so the route is still `/`, but the group is a real directory and can hold a `loading.tsx` whose subtree is that one page. See the measurements under consequences — this is the difference between `/` streaming a shell in ~5 ms and holding the whole document for ~100 ms.

3. **The rule is pinned by a test that can actually fail.** `app/not-found-probe/page.tsx` is a permanent one-line segment whose render calls `notFound()`, and `e2e/not-found.spec.ts` asserts `response.status() === 404` against it. The unknown-route spec is kept — it covers a real, separate path — but it is no longer mistaken for a guard.

4. **The rule is enforced across the whole tree, not just at the one call site the e2e visits.** `app/not-found-boundary-wiring.test.ts` walks `apps/web/app`, finds every `notFound()` call site, and fails if any Suspense boundary — a `loading.tsx`, or a `<Suspense>` in a `layout.tsx`/`template.tsx` — sits in that call site's own segment or any ancestor. The failure message states the rule and names the three ways out (move the boundary down, move the call site out, delete the boundary).

   This exists because change 2 alone was **unenforced**. Each `loading.tsx` carried its constraint as a comment, and a comment stops nobody; the e2e assertion covers exactly one call site — the fixture at the app root, where no ancestor boundary exists — so it is structurally incapable of catching the case those comments anticipate. Adding `app/projects/[id]/page.tsx` calling `notFound()` — literally the example written into `app/projects/loading.tsx` — serves 404 markup under a 200 while the entire suite stays green. Verified by doing exactly that; see consequences. That matters most in a derived project, which inherits every `loading.tsx` and its unenforceable comment along with the skeleton.

### Why a dedicated fixture route rather than a real one

The assertion needs a segment that renders and then calls `notFound()`, and this skeleton has no domain route that 404s on its own. The honest options were to invent one or to be explicit that this is a fixture; inventing a fake domain route would have hidden the test's purpose behind plausible-looking product code.

The fixture is safe to ship into every derived repo. Its entire behaviour is "answer 404", which is what a nonexistent path already does — to a visitor or a crawler it is indistinguishable from a typo'd URL. It renders no data and exposes no surface. A derived repo that finds it distasteful should repoint the spec at one of its own `notFound()` call sites **and then** delete it; deleting both leaves the rule unguarded, and the failure mode it guards against cannot be seen by looking.

## What was considered and rejected

- **Keeping the root `loading.tsx` and banning `notFound()` below it.** Rejected: that bans `notFound()` from the entire application, which is the opposite of what an App Router app needs.
- **An ESLint rule forbidding `app/loading.tsx` at the root.** Rejected as insufficient rather than wrong: it would catch exactly one of the several shapes that re-create the defect (measurement 3 shows a hand-written `<Suspense>` in `layout.tsx` does the same, and measurement 4 shows a segment-level file does it too). A rule that catches one shape of a defect and is trusted to catch the class is worse than no rule. Change 4 catches all three file-tree shapes instead of one, for the same cost.
- **Asserting the 404 STATUS in a unit test.** Still rejected, and this is the distinction that took a second pass to see: the _status_ lives in a streamed HTTP response, so there is nothing to assert without a real server and a real request, and a test that stubbed one would be pinning the stub. But the _structure that produces it_ — which segment directories hold a boundary, and which hold a `notFound()` call site — is plain data on disk. Asserting the status needs a server; asserting the shape does not. Change 4 asserts the shape.
- **Leaving the rule to a comment in each `loading.tsx`, and the e2e assertion.** This is what the first draft of this ADR shipped, and it was wrong — not in its analysis, in its enforcement. Two claims in that draft are corrected here. (a) "No lint rule can see a Suspense boundary and a `notFound()` call site as related, because the relationship is a runtime render-order fact, not a static one." False as stated: the render-order fact is _derived from_ App Router file conventions, so segment ancestry on disk decides it for every shape a file convention can express. A static check cannot see a `<Suspense>` written inline in a page's own JSX above an imported child — that residue is real, and it is why the e2e status assertion is kept — but the shapes it _can_ see are the ones a contributor actually writes. (b) "The e2e assertion catches all of them, because it measures the property rather than the syntax." False: it measures the property at **one URL**. It cannot fail for a `notFound()` it never visits, and the call sites at risk are precisely the ones under the new boundaries. The generalisable lesson: **a guard that measures the right property at one point is not a guard on the property** — check its coverage the same way you check its mechanism.
- **A route group (`app/(home)/loading.tsx`) to give `/` its own boundary back.** The first draft deferred this as "outside this change's lane" and left `/` with no boundary. Reversed, on measurement: `/` meets this ADR's own stated criterion for deserving a boundary — its `page.tsx` awaits a prefetch before it can render anything — and skipping it cost the entire prefetch in time-to-first-byte on the app's most-hit route. The move is three files and no URL change. Deferring it also left the ADR internally inconsistent: it applied its criterion to `/account` and `/projects` and not to `/`.

## Consequences

- **The rule is permanent and architectural, not a version-pinned workaround.** Measurement 3 establishes that no Next release will fix it, because there is nothing broken to fix: streaming means the status goes out first. Any future contributor who adds a root-level `loading.tsx`, or wraps the root layout in `<Suspense>`, re-creates the defect in full — across every route at once, silently, with a green-looking 404 page in the browser.

- **`/` keeps its shell flush, and the route group is what buys it — measured.** Production build, `next start -p 3272`, `NEXT_PUBLIC_ENABLE_MSW=true` so the home prefetch actually runs, direct `curl` at the origin, warmed, six samples each; port ownership proven via `ss -ltnp` + `/proc/<pid>/cwd`. Only `app/(home)/loading.tsx` differs between the two builds. `/login` is the control: same layout, no async page data.

  | Route                           | `time_starttransfer` (TTFB) | `time_total`    |
  | ------------------------------- | --------------------------- | --------------- |
  | `/` — no boundary (first draft) | 0.092 – 0.144 s             | 0.094 – 0.150 s |
  | `/` — `(home)` boundary         | **0.005 – 0.006 s**         | 0.086 – 0.153 s |
  | `/login` — control              | 0.003 – 0.026 s             | 0.004 – 0.028 s |

  The signature, not the absolute numbers, is the finding. Without the boundary **TTFB ≈ total**: zero streaming, the document is held until the prefetch resolves. With it, TTFB collapses to the control's — the shell is on the wire immediately — while `time_total` is unchanged, because the data still takes as long as it takes. Here the prefetch is an in-process mock; against a real API the held interval is a full network round-trip, on the app's most-hit route. `/not-found-probe` was re-checked at `404` on the same production build, so the group's boundary does not leak upward.

- **The `(home)` group is now itself under the rule, and the guard knows it.** `app/(home)/` is an ordinary segment directory to `app/not-found-boundary-wiring.test.ts`: a `notFound()` added anywhere in the group turns it red, naming `app/(home)/loading.tsx`. Verified by adding one. Keep the group to the home route — the moment a second, 404-capable route joins it, the boundary moves down instead.

- **Red-before / green-after, measured in the suite that ships.** With the root `loading.tsx` restored, `WEB_PORT=3212 pnpm --filter web exec playwright test e2e/not-found.spec.ts` gave `1 failed / 1 passed` — the new assertion failed on `Expected: 404 / Received: 200`, and the pre-existing unknown-route test **passed in the same run**, which is the demonstration that it never guarded this. With the file deleted, the full hermetic suite is `6 passed` (re-run at `WEB_PORT=3272` after the route-group move: still `6 passed`).

- **The source-contract guard was disarmed three ways, one per shape it claims to cover.** Each was introduced, shown red, and removed: (1) `app/projects/[id]/page.tsx` calling `notFound()` → red, naming `app/projects/loading.tsx` — the exact case that file's comment anticipated and that nothing could catch before; (2) the root `app/loading.tsx` restored → two assertions red at once, the general rule and the explicit root check; (3) a `template.tsx` wrapping `<Suspense>` above `app/not-found-probe/` → red, naming the template, which is measurement 3's hand-written shape. It also asserts it found at least one `notFound()` call site, because a file walk that matches nothing passes forever — the vacuity failure that would otherwise turn this guard into the very thing it was written to replace.

- **Dev-only console noise from the fixture.** In `next dev`, React's profiling instrumentation logs `Failed to execute 'measure' on 'Performance': 'NotFoundProbe' cannot have a negative time stamp` for a component that throws instead of returning. It is a dev-mode timing artifact, absent from production builds, and does not affect the status or the rendered output. Recorded so it is known rather than rediscovered as a symptom.

- **What a repo draining this must do.** Delete its own root `apps/web/app/loading.tsx`; move that UI down to the segments that fetch, using a route group for `/`; add the fixture route, the status assertion, and `app/not-found-boundary-wiring.test.ts`. The guard is the part worth taking first — it is the only piece that scales to a repo with real `notFound()` call sites, and it needs no configuration beyond running in the unit suite. Then audit for the one shape it cannot see: an explicit `<Suspense>` written inline in a page's JSX (or supplied by a provider component) above an imported child that 404s. **Re-measure in your own tree**; do not take this ADR's tables as a substitute. The whole reason this defect survived is that everything downstream of it looks correct.

- **Generalisation.** [ADR 1027](1027-check-types-preflight-config-load.md) closed on "a gate that can be satisfied without running is not a gate." This is its sibling for tests: **a test that asserts the right value through the wrong mechanism is not a guard.** `unknown route renders the 404 page` asserted `404` and passed, for the entire life of this skeleton, while the property it appeared to protect was broken — because the router path it exercised and the render path that was broken never met. When a test and a defect share a symptom, confirm they share a **code path**, by making the test red on purpose.

  The second pass added the other half, and it is the one that bit twice here: **mechanism and coverage are separate checks, and passing the first says nothing about the second.** The replacement assertion exercised the right code path — at exactly one URL, the only one in the tree with no boundary above it, so it could never fail for the call sites the new boundaries actually endanger. Its companion failure is the same shape in prose: a constraint written as a comment in the file that creates it (`nothing in this subtree may call notFound()`) has a mechanism — a reader — and no coverage. **If a rule's enforcement cannot name the offender, it is documentation.** Ask of every guard: what is the set of things this can fail on, and is it the set the rule applies to?

## Sources

- [ADR 0025](0025-web-e2e-playwright-shared-vitest-config.md) — the Playwright suite this guard lives in.
- [ADR 0020](0020-i18n-next-intl-use-intl.md) — the `cs` default locale, hence the Czech catalog string used to confirm the 404 body under the 200.
- [ADR 1012](1012-e2e-web-port-multiseat.md) — the `WEB_PORT` discipline and the port-ownership proof used for every measurement above.
- `apps/web/app/not-found-boundary-wiring.test.ts` — the tree-wide guard (change 4).
- `apps/web/app/not-found-probe/page.tsx`, `apps/web/e2e/not-found.spec.ts` — the status assertion (change 3).
- `apps/web/app/(home)/page.tsx`, `apps/web/app/(home)/loading.tsx`, `apps/web/app/projects/loading.tsx`, `apps/web/app/account/loading.tsx` — the three scoped boundaries (change 2).
