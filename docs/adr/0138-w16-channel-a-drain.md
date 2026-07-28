# ADR 0138 — W16 channel-A drain `a55e8bc..e240395`: the security span, and the four deviations re-expressed rather than deleted

**Status:** Accepted (2026-07-28). Implemented.

Drains fullstack-skeleton `a55e8bc..e240395` — the W13 wave (skeleton ADRs
1032–1039) and the W15 wave (skeleton ADRs 1040–1046) — into perimetra, and
bumps `package.json#skeleton.baseCommit` to `e240395` in the same commit. Each
drained ADR keeps its upstream number and its body verbatim per the reserved-band
rule; `docs/adr/README.md` carries one provenance row per ADR, and those rows are
where the per-ADR perimetra delta is recorded. This ADR records what is true of
the drain as a whole: what was taken, what was deliberately left, and the four
deviations that had to be re-expressed rather than reverted.

## Context

Martin's 2026-07-14 monorepo ruling narrowed drains to **security and correctness
content only** — the cure for propagation pain is the fold, not a wider drain.
This span is almost entirely security content, so the ruling cost the drain very
little: the only thing it excluded on scope grounds was the mobile catalog's
patch-level Expo bumps, and those were taken anyway (see §4).

Perimetra's recorded `skeleton.baseCommit` was `a55e8bc`, seven commits behind.
The span end was **pinned at `e240395`** before work started, because the skeleton
seat was live in the same wave; the pin held — fullstack `main` was still
`e240395` at land time.

## The shape of the drain

The first thing worth recording is a measurement, not a decision: **62 of the 79
files the span touches were byte-identical to `a55e8bc` in this repo**, so most of
the drain was a wholesale take rather than a merge. That is the channel-A model
working — divergence concentrates in a small number of files, and those are
exactly the files where a careless take destroys something.

Where perimetra HAD diverged, a three-way merge (`git merge-file` against the
`a55e8bc` base) resolved almost everything; five files conflicted and were
resolved by hand.

**The defects in this span were not latent here. Four were live:**

1. **The `/` double-subscribe** (skeleton ADR 1039). `useNavCounts` and
   `useDashboardSummary` both subscribe `org:<id>` and are both mounted on `/`.
   The old adapter threw on a duplicate channel and `useChannel` swallowed it, so
   one of the two had been a silent no-op degrading to focus-refetch.
2. **The soft-404** (ADR 1037), and worse here than upstream. The skeleton
   shipped the cause with **zero** `notFound()` call sites; perimetra had **nine**,
   every one under the root `app/loading.tsx`, so every one served 404 markup
   under an HTTP 200.
3. **The readiness-map leak** (ADR 1035). Perimetra had independently shipped
   shape-only `details` forwarding under ADR 0126, which is precisely the rule
   ADR 1035 exists to replace — so this repo was the live instance of the leak,
   on its `@Public()` `@SkipThrottle()` `GET /health/ready`. **Measured after the
   drain against the real stack** (redis stopped, api on :4002): the anonymous
   503 body is now exactly `{"message":"Service Unavailable Exception"}`. That
   response comes through this filter — terminus's thrown body carries no
   `message` key at all, which is why the default one appears — and its own
   `details` is the readiness map, a plain object that the shape-only guard
   accepted unconditionally. The narrowing is real but was never the whole
   defence: ADR 0099 had already reduced each indicator to
   `{ message: "unreachable" }`, so what would have shipped was per-dependency
   up/down rather than a DSN.
4. **Four telemetry defects** (ADRs 1032, 1043, 1044, 1045) — the `blob:`
   fail-open, three quadratic ReDoS patterns, the unscoped `filename`/`abs_path`
   exemption, and the three-polarity `SAFE_SCHEMES` — all live at every site.

A fifth is live and is deliberately **not** fixed here; see §5.

## The four deviations re-expressed

A perimetra deviation from the skeleton is re-expressed against this repo's own
rule. It is never deleted, and it is never "restored to parity".

### 1. `SENSITIVE_KEYS` — the six-entry superset

`packages/telemetry/src/scrub.ts` was taken wholesale (the W15 design replaced
enough prose that a hunk-by-hunk merge would have fought text that no longer
exists), which **deletes** the six entries this repo carries and upstream does
not: `recipient_email`, `ico`, `dic`, `address_line`, `city`, `postal_code`. They
exist for exactly the reason `name`/`image`/`identifier` exist in the skeleton and
not in web-native — they are `pii()` COLUMNS of this repo's schema, so the ADR
0040 mirror obliges them. Re-applied after the take, with the comment block that
says why.

`scrub.pii-contract.test.ts` is what catches the loss: it reads the `pii()`
registry off disk and reds six cases if the entries go missing. Verified after the
merge that the local delta on this file was the superset **and nothing else**.

### 2. The preview-tier rule (ADR 0104)

`apps/web/scripts/preflight-config.test.ts` T1b triggers `assertTierInvariants`
with a bare `API_URL` on preview upstream, which perimetra deliberately made
LEGAL — this is a real-backend product, so a preview pointing at a real api is the
normal configuration here. **Already re-expressed in the W13 drain** against this
repo's own preview violation (mocks explicitly on WITH a backend origin, where the
mock wins at the BFF and the configured origin is silently ignored). The property
under test is the throw site, not the rule. The span does not touch that file, so
nothing was owed this wave; recorded because "T1b will red" is in the drain
briefing and a future seat needs to know it was already paid.

### 3. `apiFetch`'s abort handling (ADR 1033)

Perimetra had **already fixed this defect independently**, with an inline
`cause.name === "AbortError"` test, measured against the ADR-0129 delivery-state
query during the eyes-on pass (12 console errors across one navigation sweep). The
drain replaces the local test with upstream's shared `isAbortError` predicate — the
one `retry.ts` already used — so the log-suppression rule and the retry rule cannot
drift on what counts as a cancellation, and keeps the perimetra measurement as a
comment.

**What upstream added here was the single source of truth, not the behaviour.**
That is the general shape a seat should expect on any drain into a repo that has
been fixing its own bugs: a repo that already shipped its own version of a fix
still owes the drain, because what upstream added may be the justification or the
factoring rather than the behaviour.

### 4. Two Playwright suites, one gate step (ADR 1038)

The upstream gate step runs the root `test:e2e`, which resolves to the hermetic
mock-mode suite. Perimetra has a second, real-stack `@smoke` suite, and it is
deliberately NOT wired into the Stop-hook gate: it needs `docker compose` up and a
running api, which a Stop hook must never assume and must never boot. Its config
already hardcodes `reuseExistingServer: false`, so it was never exposed to the
silent-substitution class ADR 1038 closes.

The cost of that scoping is stated in `apps/web/e2e/README.md` so it cannot be
misread: **a seat that arms `.git/claude-gate-e2e` and sees green has covered the
mock suite only.** The authed surfaces live in the smoke suite.

## The two supply-chain overrides this repo owes and upstream does not

`brace-expansion@2` → `^2.1.2` (GHSA-3jxr-9vmj-r5cp) and `form-data` → `^4.0.6`
(GHSA-hmw2-7cc7-3qxx), both reached through `@miklik1/cardo-tax-cz`, a dependency
chain the skeleton does not have. Upstream measured `brace-expansion@2.1.1` as
unflagged in ITS tree and left the v2 line alone; in this tree the audit flags it.

**This is upstream's own rule applied, not a deviation from it** — the override
block's argument is that _the audit, not a guess about the advisory's stated range,
is the oracle_. Result: perimetra's `pnpm audit --prod` goes 4 high → **2**,
matching upstream exactly, and both remaining highs are the documented residues
(`brace-expansion` v1 has no fix on its line; `@opentelemetry/propagator-jaeger` is
deliberately not overridden because 2.9.0 pins `@opentelemetry/core` exactly and a
lone override installs a second OTel core). ADR 0131 enlarges the lockstep set the
eventual real fix must move, by one package.

Three comment blocks in `pnpm-workspace.yaml` were re-expressed rather than
inherited, because each made a claim about the SKELETON that is false here: the
bull-board mount is in `modules/jobs/jobs.module.ts` and not `common/config/env.ts`;
all four Next advisory preconditions were re-verified for a shipping app with 40+
routes rather than for a template; and the better-auth advisory's magic-link /
email-OTP flows are **not configured here at all** (this repo runs `admin()`,
`organization()` and `twoFactor()`). The bump is taken anyway, and the comment now
says why: which plugins are enabled is an application property one commit away from
false, and nine minors of drift on the identity library is a worse thing to owe
than a patch bump is to take.

## What was deliberately left

### 1. The font chain (skeleton ADR 1036) — body drained, fix NOT applied

> **CORRECTED BY ADR [0139](0139-a-computed-string-is-not-a-rendered-pixel.md)
> (2026-07-28). Do not act on this section.** The scoping defect described below
> is real, but the conclusion drawn from it is wrong. The measurement compared
> computed `font-family` **strings**, which differ between the two placements
> without a single pixel moving. `@font-face` rules are document-global, and CSS
> family names are ASCII case-insensitive while `next/font/local` names each face
> after its JS variable (`synonym` — it does **not** mint a hashed name), so the
> literal `"Synonym"` fallback matched the real face all along. Rendered width is
> identical across both placements. Only `--font-mono` was genuinely dead, because
> its fallback arm was the generic `ui-monospace` rather than a family name. There
> was no product-wide re-render to fear and the `.verify/*` corpus was never
> invalidated. Kept unedited below as the record of what was believed.

The ADR body is drained and its index row records the measurement, because the
defect it describes **is live here and the knowledge must not be lost**. The fix is
not applied, on Martin's explicit call (2026-07-28).

A `@theme` token declared at `:root` cannot read a `next/font` variable declared on
`<body>`: custom-property `var()`s are substituted on the DECLARING element, so the
framework variable is out of scope one element too low. Perimetra's case is
strictly worse than the skeleton's — all four faces are declared on `<body>`, the
fallbacks are literal family names while `next/font` mints hashed ones, and
`globals.css` is already token-correct, so there is no accidentally-working second
chain. **The entire ADR 0078 brand trio plus Geist Mono has been inert in the
browser since it shipped.** Measured three ways: the compiled Tailwind output, the
source, and computed `font-family` read out of real Chromium with the classes on
`<body>` (system font) versus on `<html>` (the vendored face).

The fix is four class names moving one element up. Its consequence is that every
surface re-renders in different faces, which invalidates `/brand-lab`, the
`capture-brand.mjs` output and the whole `.verify/*` PNG corpus — everything
typography-tuned was tuned against the wrong faces. That is a visual change, and it
does not belong in a security drain. It is scheduled as its own change with a
before/after capture pass. `tooling/tailwind-config/theme.css` still carries the
false premise that produced the bug and is corrected there, not here.

### 2. Loading UI, and the `(home)` route group (ADR 1037)

Upstream deleted the root boundary and pushed `loading.tsx` down into three
segments. Perimetra deletes the root boundary and adds **nothing** back. Loading UI
is polish under the narrowed-drain ruling, and the eligibility map makes the
partial version worse than either extreme: every high-traffic segment here
(`/quotes`, `/orders`, `/invoices`, `/site`, `/platform`) has a `notFound()` call
site beneath it, so a `loading.tsx` there would re-create the defect and red the
new guard. Adding one only to the few eligible segments produces an inconsistent
app. The `(home)` route group was not created for the same reason.

**The accepted cost is TTFB**, and it is real: with no boundary, a data route holds
its document until its RSC prefetch resolves, and ADR 0135 had just made that
server HTML meaningful. A 404 status is a correctness property; a shell flush is a
rendering nicety. If the hold becomes a problem, the fix is a segment-level
boundary BELOW the call site, not a root one.

### 3. `tooling/prettier-config/index.js`

Byte-clean locally and changed by the span, but the change is the Tailwind
class-sorting wiring — formatting, not security, and it re-sorts files. Out of
scope; it stays owed and will present again on the next drain.

### 4. CI

Untouched. CI is parked until release by Martin's ruling, and the `auditConfig.ignoreCves`
citation that `SECURITY.md` and `ci.yml` both carry is known-false in both repos —
upstream deliberately did not correct it because that means editing the parked CI
surface. Matching that residue is the right call for a drain; widening into CI is not.

## Consequences

- **`skeleton.baseCommit` is `e240395`.** A drain whose base pointer lags is a
  drain nobody can verify.
- **The realtime fan-out is a behaviour change, not only a fix.** Both `org:<id>`
  consumers now fire on every publication where exactly one did before, so each org
  domain event triggers two TanStack invalidations. That is the correct behaviour
  and it is also more work per event.
- **A latent mount-order landmine now exists** where none did: if anyone gives
  `useNavCounts` or `useDashboardSummary` a `since`, `[no-since, since]` throws a
  since-conflict to the nearest error boundary while `[since, no-since]` is silent,
  and which order applies depends on which component mounts first.
- **Retrospective, and it is not a small thing:** ADR 1042 means any gate-green
  claim made in this repo on a new-file-only change was worth nothing. The gate
  exited 0 having run no checks whenever the only change was an untracked file.
- **An upstream doc drift was corrected rather than propagated.** Upstream's own
  index row for ADR 1039 names the new required field `attach`; the field that
  shipped is `origin` (`SubscribedOrigin`), and `attach` appears nowhere in
  `packages/realtime/src`. Perimetra's row says `origin`. **Owed upstream**, along
  with the ADR-1044 sibling defect (`STRUCTURAL_KEYS` is still a bare key name
  matched at any depth) which this drain does not close.
- **`scripts/check-adr-links.mjs` found five dangling citations here on its first
  run**, all repointed. Every one cited a perimetra ADR under a name it never had —
  a draft filename renamed before landing. That is the same class as the upstream
  renumber the guard was written for, arriving from a different direction, and it
  was invisible to every green gate this repo has ever run.

## Sources

- Upstream ADRs 1032–1046, drained verbatim; see `docs/adr/README.md` for the
  per-ADR provenance row and perimetra delta.
- Span: fullstack-skeleton `a55e8bc..e240395` (`80cdb28`, `142a768`, `1076a5a`,
  `96970e6`, `13a1d2b`, `d86c75a`, `e240395`).
- ADR [0042](0042-template-lifecycle.md) — the channel-A drain contract and the
  `skeleton.baseCommit` merge anchor.
