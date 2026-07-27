# ADR 1031 — The repair grew the allow-list and not its callers: nine defects the ADR 1030 review found

**Status:** Accepted (2026-07-26) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Amends [ADR 1030](1030-url-bearing-values-are-reduced-by-the-parser-or-redacted.md); the design stands, its vocabulary and its callers did not. Landed together with the web-native-skeleton twin, **ADR 1031**.

## Context

ADR 1030's `safeUrlOrRedact` is correct. A 2520-case sweep over scheme × authority × path × delimiter forms found no input where a payload survives it. Nothing below is a defect in the primitive.

Everything below is a defect in what **decides whether to call it**, or in **which names it is called for** — and that is the same shape as the six rounds ADR 1030 was written to end, arriving one layer out. ADR 1030 says it plainly:

> a rule can never be closed at one sink and missed at another

and then closed the rule at the primitive while leaving four callers reciting an `http`/`https` vocabulary the primitive had outgrown. **The repair for a defect is new unguarded surface** — W11's lesson, earned again.

An adversarial refute-by-default review raised 24 findings across six dimensions and 31 agents; 16 survived independent verification, 8 were refuted (on producibility or reachability, not on mechanics). Deduplicated, they are the nine defects below. Every one is fixed here, in both skeletons, with a regression test that reddens when the fix is reverted — all 15 guards disarmed against the landed tree and all 15 red.

## The defects, and what each one teaches

### 1. The gate that decides whether to call the primitive knew only http/https — LEAK

`URL_SHAPED` was `/^(?:https?:)?\/\/|^\//` while `SAFE_SCHEMES` held seven schemes. The three added ON PROVENANCE for the web-native lineage's native build — `capacitor:`, `ionic:`, `file:` — were invisible to every caller that gates on it, so:

```
scrubTransaction("capacitor://localhost/detail?surname=Novakova")
  -> "capacitor://localhost/detail?surname=Novakova"   (byte-identical)
safeUrlOrRedact("capacitor://localhost/detail?surname=Novakova")
  -> "capacitor://localhost/detail"                    (correct)
```

Reachable through `beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb` and `beforeSendSpan` — the event `transaction`, a span `description`, and the `to`/`from` branch. The suite pinned the primitive on this exact input and never drove it through a caller: **a green gate that is evidence about the tests, not the code.**

Fixed: the gate asks the parser (`/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i`) instead of restating a scheme list. Deciding what is SAFE stays the primitive's job; the gate only decides what gets asked, so the two can no longer disagree.

### 2. A bare-URL span description had no request line to match — LEAK

`scrubDescription` reduced the URL only inside a `VERB url` request line. Sentry writes resource and fetch span descriptions as the **bare URL**, so those reached the free-text pass, which needs a `://` and an http-family scheme.

Fixed: a description with **no whitespace** that parses as a safe-scheme absolute URL is reduced. The guard is what makes this safe on a field that also carries SQL and prose — both contain spaces, so neither can reach the primitive and neither is truncated at a stray `?`.

### 3. The request-line verb list was closed — LEAK

`TRACE`, `CONNECT`, `PROPFIND`, `QUERY` are real methods; each reached `redactString`, which has no bare-path rule. Fixed: `[A-Z]{3,10}` plus the anchored no-space-after-URL shape, which is what still rejects `DELETE FROM users WHERE id = ?` — the reason the list existed.

### 4. `filename` / `abs_path` were exempt from ALL redaction — LEAK

In a browser stack frame these hold the script's URL, and for an error thrown from an inline or eval'd script that URL **is `location.href`** — the page with its querystring. One JS error on `/clients?search=Novakova&rc=…` shipped the search term in every frame, on the ERROR path, at the default `tracesSampleRate: 0`. The exemption also disabled the value-shape pass, so a rodné číslo in the same string survived twice.

Fixed with a **deliberately narrow** rule, `reduceSourceLocation`, because the obvious fix breaks the thing the exemption protected: the full primitive rewrites `ok.js` to `/ok.js` and REDACTS Sentry's own `app:///…` frames as an unlisted scheme, either of which breaks source-map resolution and issue grouping. The leak only ever arrives as a safe-scheme absolute URL, because that is what a page URL is. So: parse; reduce a safe-scheme absolute URL; return anything else unchanged and un-pattern-redacted. This is the one place the module returns its input, and it is stated as the exemption it is rather than hidden in a key list.

### 5. `scrubSpan` spread `links[].attributes` untouched — LEAK

A span has **two** attribute bags and they hold the same vocabulary. `data` was scrubbed; `links[].attributes` rode through the spread, so a value this function redacts from one bag shipped verbatim from the other **in the same envelope**. Fixed: one `scrubBag` helper, both bags. The test asserts no payload marker survives in either — not that the two agree, because two paths that leak identically agree.

### 6. The url-name suffix rule enumerated ONE separator — LEAK

`/(?:^|_)(?:url|uri|href|referrer|referer)$/i`. HTML attribute names separate words with a **hyphen**, so the rule covered `data_href` (which nothing produces) and missed `data-href`, `data-url` and `data-src` (which `data-*` attributes actually look like, and which posthog-js serialises verbatim into both `$elements` and the chain). camelCase (`callbackUrl`) missed too. A rule written to stop the vocabulary being an enumeration was itself enumerating.

Fixed: separator class `[_\-.]`, plus a camelCase rule tested **before** lower-casing — because lower-casing destroys the only boundary there is (`callbackUrl` and `curl` both end in `url` once folded; only the capital distinguishes them). `src` joins the compound rule as well as the whole-name set: a name is URL-bearing whether it **is** `src` or merely **ends in** it.

### 7. Attribute names were matched as bare property names — FUNCTIONAL BREAK

`action`, `data`, `cite`, `background`, `profile`, `archive` are among the most ordinary property names an app can choose, and they were matched globally:

```
{ action: "signup_completed", data: "user pressed save", cite: "Nováková, 2026" }
  -> { action: "/signup_completed", data: "[Filtered]", cite: "[Filtered]" }
```

A redaction rule had become a data-corruption rule — the same failure the `$heatmap_data` merge exists to prevent, arriving through the vocabulary instead of the accumulator.

Fixed with **three tiers**: unambiguous names (`href`, `src`, `pathname`, …) stay global, because a property called `href` holds a URL wherever it appears; ambiguous names are **attribute-scoped**, keeping full coverage inside the chain, inside `$elements`, and under an explicit `attr__`; and a third tier for §9. The `$elements` walk now enters attribute context, so the structured twin and the serialized chain share one vocabulary — the symmetry rounds 4 and 5 broke.

`pathname` was moved to tier 2 in drafting and the ported corpus **caught it**: posthog-js sets `$pathname` on every pageview, so it is a first-class property, not only an attribute. It is tier 1.

### 8. The structure-segment marker set was wrong in BOTH directions at once

- **Too broad on `#` — FUNCTIONAL BREAK.** A Tailwind arbitrary colour (`bg-[#0f172a]`) contains a `#`, so the entire `$elements_chain` was redacted for any click on any page using arbitrary hex colours. On a typical Tailwind app, autocapture was annihilated wholesale, with no URL and no PII anywhere near the event. Over-redaction is the safe direction while it stays a trade; at that scale it is a break.
- **Too narrow on the schemes — LEAK.** `//`, `?` and `#` are the punctuation of a _hierarchical_ URL. `bg-[url(data:text/csv,Novakova;8001011234)]` and `bg-[url(mailto:jana@firma.cz)]` contain none of them, so a class name shipped a rodné číslo verbatim — re-opening, inside the structure half, the exact non-hierarchical-scheme leak ADR 1030 §3 closed for values.

Fixed by naming **CSS's URL producer** (`url(`) rather than enumerating schemes a payload might use — the right level of abstraction, because CSS has exactly one syntax for embedding a URL and a scheme list would have to be re-listed at the next sink. `#` now redacts **unless every occurrence is a CSS hex colour** (3/4/6/8 digits, not followed by more name characters). That exemption is stated rather than hidden and cannot help an author hide anything: a `#` followed by anything that is not exactly a hex colour still redacts.

### 9. `ph_keyword` shipped the user's search query — LEAK

MEASURED in the installed bundle: the referring-search-engine helper does `s.ph_keyword = Is(r.referrer, "q")` (or `"p"` for Yahoo) — it lifts the **search term out of the referrer** and sends it as a first-class property. A user arriving from a Google search for "Nováková 800101/1234" sent that string verbatim.

It is one key away from the `$referrer` this file has always scrubbed, and it was missed because the vocabulary asked _"is this a URL?"_ — the answer here is **no**, which is precisely why it leaked. Fixed with tier 3: names whose value is a bare search term have no path to keep and are redacted whole. The `$session_entry_` inversion carries the policy to `$session_entry_ph_keyword` with nothing added, which is what a transform buys over a list.

### 10. The EXPLICIT capture sink had neither vocabulary — LEAK

`createPosthogAnalytics` ran `scrubEvent` alone — the **Sentry** walk, whose URL key list deliberately excludes the analytics names on the stated grounds that "those are the analytics module's names". On this path they were nobody's:

```
trackEvent("row_clicked", { href: "/clients?search=Novakova&rc=8001011234" })
  -> { href: "/clients?search=Novakova&rc=[Filtered]" }    // surname survives
```

Only the rodné-číslo _shape_ was caught. A relative href has no `://` for the free-text pass and no Sentry key rule to match, and the **autocaptured twin of the same value was reduced correctly by `before_send` in the same session** — the silent asymmetry this lineage keeps producing, here between the automatic and the explicit sink rather than between two representations of one value.

Fixed: the adapter composes both vocabularies — `sanitizeAnalyticsProperties` first (URL-bearing values reduced by the parser, bare search terms dropped), then `scrubEvent` for sensitive keys and value shapes. **Mobile gets this for free, which matters because the installed `posthog-react-native@4.46.11` / `@posthog/core@1.30.5` expose NO `before_send` seam at all** (verified by grep over both installed packages: zero hits for any hook name). On native this adapter is the only sink there is, so this is not a nice-to-have.

### 11. The REQUIRED prop was pinned by nothing — TEST ADEQUACY

ADR 1030 §7 made `sanitizeProperties` required so a scrubber-less root would not compile. The review reverted it to optional **and** restored the `sanitizeProperties ? … : undefined` fail-open, and both `tsc --noEmit` and the whole flags suite stayed **GREEN**. A required prop that nothing verifies is required is a comment.

Fixed with the only construct that can pin a type-level requirement: a mount with `@ts-expect-error`. If the prop goes back to optional, the directive becomes **unused** and `tsc` fails. A runtime companion asserts `before_send` is always a function, so the conditional form reddens too.

### 12. Session replay was the one unscrubbed capture path — LEAK, closed by DEFAULT

`before_send` deliberately short-circuits `$snapshot` batches, because walking rrweb's serialized DOM breaks replay and desyncs `$snapshot_bytes`. That rationale is sound and is kept. Its consequence was not stated: replay payloads carry the page URL with its querystring and are the one path this scrubber does not clean — and replay is enableable **from the PostHog UI with no code change and therefore no review**, the same hazard class the `$heatmap_data` comment already flags.

Fixed by closing the default: `disable_session_recording: true`. A project that wants replay turns it on **here**, and owes rrweb-side masking plus PostHog's own URL masking when it does. That is a security default, not a product preference.

## Also repaired: three superseded-mirror defects, and one vacuous test

Found while porting, all live in the landed trees:

- An **orphaned JSDoc** for the deleted `dropUrlQuery`, left sitting directly above `SAFE_SCHEMES` in fullstack's `scrub.ts` and describing the exact design ADR 1030 retracts. Plus eight stale prose references to that function across four files in both trees. The superseded-mirror class W11 already flagged twice — a doc that outlives its subject reads as current.
- A **vacuous test**: `keeps a $heatmap_data bucket whose key is `**proto**``was titled as pinning the`Map`accumulator. Swapping the`Map`for an object literal left the suite GREEN, because every merge key now goes through`safeUrlOrRedact`first, so a bare`**proto**`is normalised to`/**proto**`before it is ever used as a key and the`[[Set]]`hazard is structurally unreachable (executed: no input yields the bare key). The`Map` is kept as defence-in-depth; the test now pins the **normalisation**, which is load-bearing. This is a green test certifying a guard it does not exercise — the second-order trap the vault finding names, recurring one file over inside the very change that fixed its sibling.
- The **final-even-segment parity check** was unpinned: its one fixture was also caught by the structure-payload rule, so deleting the check left the suite green. Its new fixture deliberately carries no `//`, `?`, `#` or `url(`, so only the alignment check can catch it.

## What was REFUTED, and why that matters

Eight findings did not survive: `http.response.header.location` (not emitted by the installed SDK), the `URL_SHAPED` scheme gap filed a second time as a _span-data_ leak (the URL-key branch already routes those), a bare `referrer` property "over-matching" (a false redaction, not a leak, and the right direction), the `SYNTHETIC_ORIGIN` branch (mutation coverage, no payload survives), the server-side `apps/api` PostHog client (no call sites exist), and the same scheme asymmetry re-filed against web-native as high-severity (mechanically real, but `capacitor`/`ionic` have **no producer** in that repo — 0 hits outside its PII registry). Recording the refutations is part of the discipline: a review that only reports hits cannot be audited, and two of these were mechanically correct and still not defects.

## Consequences

- **`URL_SHAPED` is now scheme-agnostic**, so any scheme-bearing value is _asked_. Values on unlisted schemes reach the primitive and REDACT rather than passing a gate that never noticed them. Loud and safe.
- **More autocapture detail survives, not less, in one specific place**: Tailwind arbitrary-colour class names no longer destroy the chain. Everywhere else this ADR tightens.
- **Ordinary app properties named `action`/`data`/`cite` are no longer corrupted.** Any derived repo that was silently receiving `/signup_completed` will start receiving `signup_completed` again — a data-quality fix that may show up as a change in existing dashboards.
- **Session replay is off until switched on in code.** A derived repo relying on enabling it from the PostHog UI will find it inert.
- **`trackEvent`/`screen` now redact more**, including on mobile. A property the app deliberately sends under a URL-bearing name will be reduced.
- `reduceSourceLocation` is the one function in this module that returns its input. It is module-local here (the walk is in the same file) and its exemption is documented at its definition so it stays auditable; web-native's mirror must export it, because its registry sits a package away.

## Sources

- The ADR 1030 adversarial review: 31 agents, 6 dimensions, 24 findings, 16 confirmed by independent execution, 8 refuted. Discipline per the vault finding — assert safety not agreement; a green gate on a redaction surface is evidence about the tests; verifiers refute by default and an unexecuted verifier has produced nothing.
- `posthog-js@1.379.2` `dist/module.js` — the `ph_keyword` producer (§9), re-verified independently of the review.
- `posthog-react-native@4.46.11` / `@posthog/core@1.30.5` — no `before_send` seam (§10).
- Disarm results: 15/15 guards reddened against the landed tree.
- Vault finding — "Six adversarial rounds each certified a redaction surface correct and each was falsified by the next — the green gate never moved".
