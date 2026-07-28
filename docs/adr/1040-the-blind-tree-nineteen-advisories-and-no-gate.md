# ADR 1040 — The blind tree: nineteen high advisories, no audit gate, and a documented allow-list key that does not exist

**Status:** Accepted (2026-07-28) — HQ-ruled default under Martin's 2026-07-14
policy ("skeleton drains narrow to security/correctness content only"), Martin
ratify queued (do-first doctrine). W15 wave. Landed together with the
web-native-skeleton twin, **ADR 1033**. Amends the operating detail of
[ADR 0044](0044-security-baseline-supply-chain.md); does not change its design.

## Context

`web-native-skeleton` runs a `pnpm audit:gate` step inside its Stop hook, so a
supply-chain red there is loud — annoyingly, blockingly loud (ADR 1033). This
repo is the opposite, and the asymmetry hid the worse tree:

- there is **no `scripts/audit-gate.mjs`**, no `.audit-allowlist.json`, and no
  `audit:gate` script;
- the only audit is a CI job (`.github/workflows/ci.yml:205`) which is **parked**
  — its `if:` excludes `push`, so it runs on schedule, manual dispatch, and
  same-repo PRs only, and CI is dark for this fleet until release;
- `SECURITY.md:138`, `ci.yml:200,232` and ADR 0044 all direct the reader to
  allow-list an advisory via **`auditConfig.ignoreCves` / `ignoreGhsas` in
  `pnpm-workspace.yaml`** — a key that **does not exist in that file**, and is
  not a pnpm setting the CLI reads. The documented escape hatch was never real.

Measured 2026-07-28: **19 high production advisories**, against
web-native's 15. Two of them outrank anything on the `next` list because they
are not transitive at all.

## Decision

Fix the versions. Do **not** port web-native's audit-gate tooling into this
tree this wave — that is new drain ceremony, and it is forbidden by the second
half of the same 2026-07-14 policy sentence that authorises this bump. Do **not**
edit the parked CI job. The two-skeletons-two-mechanisms asymmetry is boarded on
the idea/debt stack, not resolved here.

### 1. `better-auth` 1.6.16 → 1.6.25 — the one that outranks the framework list

`GHSA-qq9h-g4jm-xgf3`: **account takeover via pre-account hijacking on
magic-link and email-OTP sign-in** (patched `>=1.6.22`). `better-auth` is a
**direct** dependency of both `@repo/auth` and `apps/api` — not a transitive one
— and the affected flows are sign-in flows this template ships. This is the
highest-impact advisory in either skeleton.

The catalog's `auth` entry (Better Auth's CLI, version-locked per ADR 0033)
moves in the same edit. It has to: the CLI generates schema against its own
version, so a skewed pair means the CLI generates against a different schema
than the runtime enforces.

### 2. `@fastify/static` 9.1.3 → `^10.1.2` — a crossed peer range, argued rather than accepted

`GHSA-83w8-p2f5-377r`: **route-guard bypass via path traversal**, patched
`>=10.1.1`, with **no 9.x backport**. Meanwhile
`@nestjs/platform-fastify@11.1.26` and `@nestjs/swagger@11.4.4` declare
`^8.0.0 || ^9.0.0` and `@bull-board/fastify@7.2.1` pins `9.1.3` exactly. That
mismatch is what made this look like the wave's only legitimate dated-acceptance
candidate.

It is not, and the reason is that the mismatch is a **declared range, not a
measured incompatibility**:

- v10.0.0's entire breaking change is `setHeaders(res)` becoming
  `setHeaders(reply)` (fastify/fastify-static#598).
- **No consumer in this tree passes `setHeaders`.** The only occurrence anywhere
  is a type-only field in `@nestjs/platform-fastify`'s vendored
  `fastify-static-options.interface.d.ts` — a local copy, not an import of
  `@fastify/static`'s own types — so it neither changes nor breaks `check-types`.
  `@bull-board/fastify` does a bare `require("@fastify/static")` and registers
  with `root`/`prefix`.
- The dependency set is otherwise identical to 9.1.3's (`+@fastify/error`).

And it matters here rather than being cosmetic: the two mounts this tree gives
`@fastify/static` are the Swagger UI assets and **bull-board**, which
`apps/api/src/common/config/env.ts:174` mounts _outside_ Nest behind basic auth
— precisely the "a route guard protects this static mount" shape the advisory
defeats.

`pnpm turbo run check-types lint test` is green across all 24 packages on the
bumped tree.

### 3. `find-my-way: ^9.6.1` — in range, so not a decision

`GHSA-c96f-x56v-gq3h` (HTTP/2 DDoS). `fastify@5.8.5` declares
`find-my-way: ^9.0.0`, so this is a patch bump inside the declared range, not a
forced major.

### 4. The shared transitive set — parity with ADR 1033

`js-yaml@3/@4`, `brace-expansion@1/@5`, `fast-uri`, `shell-quote`, all as pnpm
`overrides` and all major-scoped for the same reason spelled out in ADR 1033
(a bare `js-yaml: ^4.3.0` breaks `@istanbuljs/load-nyc-config`). The `undici`
override already in this file is the same mechanism and predates the block.

The `next` catalog moves 16.2.9 → 16.2.12 with the same four-advisory /
four-precondition table as ADR 1033. The reachability check was re-run against
**this** tree, not inherited: zero `"use server"`, no `i18n` key, no
`--turbopack`, and every `rewrites()` destination is either a literal PostHog
host (`eu-assets.i.posthog.com`, `eu.i.posthog.com`) or the server-side
`apiProxyTarget` env value — never an attacker-controlled hostname.

`postcss` and `sharp` land as a separate, build-verified commit.

## Consequences

- 19 blocking advisories → 2. Both residues are recorded rather than hidden:

  **`GHSA-mh99-v99m-4gvg` (brace-expansion 1.1.16).** No fix on the v1 line;
  the patched version is an API-incompatible major (measured: brace-expansion@5's
  CJS build exports a named `expand`, `minimatch@3.1.5` calls the module object
  directly, `TypeError: expand is not a function`). Reach is Jest coverage
  glob-matching at test time. web-native records this in
  `.audit-allowlist.json` with an expiry; **this tree has nowhere to record it**,
  which is itself the finding — the entry lives here instead.

  **`GHSA-45rx-2jwx-cxfr` (`@opentelemetry/propagator-jaeger` 2.7.1, DoS on a
  malformed header).** Deliberately NOT overridden. `propagator-jaeger@2.9.0`
  depends on `@opentelemetry/core: 2.9.0` **exactly**, while
  `@opentelemetry/sdk-node@0.218.0` pins the rest of the set at 2.7.1 — so a lone
  override installs a **second OTel core** beside the first, which is a silent
  context-propagation hazard, strictly worse than the advisory. The real fix is
  moving the whole lockstep set (`sdk-node` 0.220.0+ pins propagator-jaeger
  2.9.0), which is a separate slice with its own break surface in the API's
  tracing bootstrap. Reach today: **zero** — the repo never configures a Jaeger
  propagator (no `Jaeger`, no `OTEL_PROPAGATORS`, no `propagator` reference in
  `apps/` or `packages/`), so `JaegerPropagator` is never instantiated and the
  default W3C tracecontext + baggage propagators are what run. **CHECK 2026-10-28**
  with the brace-expansion expiry.

- The **`auditConfig.ignoreCves` citation is now known-false** in three places.
  It is not corrected here — correcting `SECURITY.md` and `ci.yml` means editing
  the parked CI surface, which this wave does not touch. Boarded with the
  two-mechanisms asymmetry.
- `@fastify/static` now resolves outside two declared peer ranges. pnpm reports
  this under `pnpm peers check`; the argument above is why that warning is
  expected rather than a defect. If a future `@nestjs/platform-fastify` widens
  its range, the override becomes redundant and should be deleted, not kept.

## Sources

- `pnpm audit --prod --json` against this tree, 2026-07-28 (before: 34 total /
  19 high; after: 24 total / 2 high).
- GitHub advisories GHSA-qq9h-g4jm-xgf3, GHSA-83w8-p2f5-377r,
  GHSA-c96f-x56v-gq3h, GHSA-45rx-2jwx-cxfr, plus the shared set listed in ADR 1033.
- fastify/fastify-static release notes for v10.0.0 (the `setHeaders` change) and
  the installed `@nestjs/platform-fastify`, `@nestjs/swagger`,
  `@bull-board/fastify` package manifests.
- npm registry manifests for `@opentelemetry/propagator-jaeger` 2.7.1 / 2.9.0 /
  2.10.0 and `@opentelemetry/sdk-node` 0.218.0–0.221.0.
