# ADR 1027 — `web:check-types` gates on an explicit config-load preflight, because `next typegen` swallows config failures and exits 0

**Status:** Accepted (2026-07-20) — HQ-ruled default, Martin ratify queued. Follows on from [ADR 1021](1021-api-url-https-gate-keys-on-loopback-not-node-env.md), whose `API_URL` rule this defect made unenforceable, and **corrects part of that ADR's account of the pre-fix symptom**.

> **PERIMETRA PORT NOTE (2026-07-27, channel-A drain of skeleton `cf519cd`).** The body below is the skeleton's, drained verbatim under the reserved-band rule (`docs/adr/README.md`), so its first-person "this repo" is the SKELETON's voice. The mechanism, the fix and nine of the ten test cases port unchanged. **One test case had to be re-expressed, because its premise is inverted here.** Upstream's T1b triggers the second swallowed throw site with a bare `API_URL` on the preview tier, since the skeleton forbids `API_URL` on preview outright. Perimetra deliberately reversed that rule ([ADR 0104](0104-deployment-tier-vercel-target-env.md); `packages/config/src/env/assert-tier-invariants.ts`) — it is a real-backend product, so preview legitimately points at a real api and upstream's trigger is perimetra's NORMAL configuration. The port therefore drives the same `assertTierInvariants()` throw through perimetra's own preview rule: the ambiguous-data-source PAIR (`NEXT_PUBLIC_ENABLE_MSW="true"` **with** `API_URL` set, where the mock wins at the BFF and the configured origin is silently ignored). The property under test is unchanged — a tier-invariant throw must exit non-zero, not be swallowed into an exit-0 — and the disarm proof below reproduces here. The suite's `childEnv` additionally deletes `NEXT_PUBLIC_ENABLE_MSW` and `APP_TIER`, because perimetra's preview rule is a pair rule and an ambient half of it would red the positive control for an unrelated reason.

**Provenance — booked by mercata, fixed here.** Mercata's ADR 0125 (`0125-api-url-https-gate-keys-on-loopback.md`, its drain of skeleton ADR 1021) re-measured the pre-fix symptom in its own tree rather than copying upstream's explanation, found upstream's "the gate only ever passed via a turbo cache hit" account to be false there, and named this defect explicitly as an out-of-scope follow-on: "`next typegen` swallowing env-validation failures into a non-fatal unhandled rejection is its own hole deserving its own fix and ADR, and it very likely affects the skeleton identically — a candidate to push upstream." Mercata implements **no fix** for it. There was therefore nothing to copy: what mercata supplied was a defect statement and a standard of proof, and the fix shape below is this repo's own. The reasoning here is written for this tree and was re-measured here from scratch.

## Context

`apps/web/package.json` defined the type gate as a shell `&&` chain:

```json
"check-types": "next typegen && tsc --noEmit"
```

`next typegen` loads `apps/web/next.config.js`, which imports the validated env at config-load time (`next.config.js:8`, `import { env, TIER } from "@repo/config/env/web"`) and calls `assertTierInvariants()` (`next.config.js:17`). Both of those **throw** on an invalid environment. The chain's `&&` was supposed to convert such a throw into a failed gate.

It did not. **`next typegen` reports the failure and exits 0.** Reproduced here on this tree, with the offending value supplied on the command line only (no tracked env file modified — and note that `apps/web` has no `.env.local`, only `.env.example`, so the ambient environment is the whole story):

```
$ cd apps/web && API_URL="http://staging.internal:4000" ./node_modules/.bin/next typegen
❌ Invalid environment variables: [
  { code: 'custom', path: [ 'API_URL' ],
    message: 'API_URL must use https unless it targets a loopback host (localhost, *.localhost, 127.0.0.0/8, ::1)' } ]
Unhandled Rejection: Error: Invalid environment variables
    at <unknown> (../../packages/config/src/env/web.ts:102:20)
$ echo $?
0
```

`http://staging.internal:4000` is precisely the plaintext-remote-host case ADR 1021 exists to refuse — the one that forwards bearer tokens and session cookies across a real network. Running the whole script gave the same result: `API_URL="http://staging.internal:4000" pnpm --filter web check-types` exited **0**.

**This is not "a gate that passes by cache". The gate never ran.** It was green cold, on `--force`, in CI, and on a fresh clone, so no cache-class remedy would ever have detected it. Because the hole is in the **build script shape**, every project stamped from this skeleton inherited it.

### Three findings that were not in the original defect report

**1. A second swallowed throw site.** The report described only the env-schema failure. Measuring the other config-load throw shows it is swallowed identically:

```
$ API_URL="http://localhost:4000" ./node_modules/.bin/next typegen
Unhandled Rejection: Error: assertTierInvariants: illegal environment for TIER="preview":
    at assertTierInvariants (../../packages/config/src/env/assert-tier-invariants.ts:89:11)
$ echo $?
0
```

So the hole is a **class** — anything that throws at config load is swallowed — not a single instance. This is what drives the decision to preflight the whole config rather than just the env module.

**2. The gate was also silently under-checking the thing it was chained to typegen to obtain.** A failing typegen emits nothing and still exits 0. Measured `apps/web/.next/types/routes.d.ts` mtime across runs:

| Run              | Exit | `routes.d.ts` mtime        |
| ---------------- | ---- | -------------------------- |
| baseline         | —    | `14:52:37`                 |
| bad-env typegen  | 0    | `14:52:37` — **unchanged** |
| good-env typegen | 0    | regenerated                |

`apps/web/tsconfig.json:15` includes `".next/types/**/*.ts"`. On the swallowed path, `tsc --noEmit` therefore type-checked against **stale** generated route types — or, on a cold or clean checkout, against none at all. The gate was not merely failing to enforce the env rule; it was also degrading the route type-checking it exists to perform.

**3. Scope bound — `next build` does NOT have this hole.** Same bad value, measured rather than assumed: `next build` printed `⨯ Failed to load next.config.js` / `Build error occurred` and exited **1**. The defect is specific to the `typegen` command path.

### Root cause, and how the two candidate fixes actually compare

Next installs its own userland `unhandledRejection` listener (`next/dist/server/node-environment-extensions/unhandled-rejection.external.js:470-477`, Next 16.2.9), which `console.error`s `Unhandled Rejection: <reason>` instead of letting the process die — that is the line visible in the repro above, and it is why the **default** Node mode exits 0.

> **Correction (this ADR's own false justification, re-measured).** An earlier revision of this ADR claimed that this userland listener "**suppresses Node's unhandled-rejection mode outright**, so `--unhandled-rejections=strict` and the Node major are both irrelevant here", and rejected the flag as **inert**. **That claim is false, and it was measured to be false in this tree** on Node v24.16.0 and Next 16.2.9 — the same versions the original claim was written against:
>
> ```
> $ cd apps/web
> $ API_URL="http://staging.internal:4000" ./node_modules/.bin/next typegen ; echo $?
> Unhandled Rejection: Error: Invalid environment variables
> 0
> $ NODE_OPTIONS="--unhandled-rejections=strict" API_URL="http://staging.internal:4000" ./node_modules/.bin/next typegen ; echo $?
> Error: Invalid environment variables
>     at async Module.nextTypegen (…/next/dist/cli/next-typegen.js:78:24)
> 1
> $ NODE_OPTIONS="--unhandled-rejections=strict" API_URL="http://localhost:4000" ./node_modules/.bin/next typegen ; echo $?
> Error: assertTierInvariants: illegal environment for TIER="preview"
> 1
> ```
>
> The flag **does** enforce, at **both** throw sites. Note that under `strict` the `Unhandled Rejection:` line does not appear at all: Node raises the rejection as an uncaught exception rather than dispatching to the userland listener, so the listener never gets to swallow it. `web-native-skeleton` ships exactly `NODE_OPTIONS="${NODE_OPTIONS:-} --unhandled-rejections=strict" next typegen` as its `check-types`, and that gate enforces.
>
> **The decision below still stands — the reasoning for it was wrong, not the choice.** The flag is a _working_ alternative, not an inert one, and this ADR says so plainly. The preflight is preferred on a different and now-actually-true ground: it does not depend on Node rejection semantics at all. It runs in a process we own, sets its own exit code from an awaited `try`/`catch`, and additionally covers the "config loaded but exported nothing" and "the preflight could not run at all" arms that no rejection flag can reach. `NODE_OPTIONS` is also an inherited-environment mechanism — anything that resets or overwrites it downstream (a CI runner, a wrapper script, a turbo task env) silently disarms the flag, whereas the preflight is a command in the chain that cannot be disarmed without editing the script.
>
> Recording this correction rather than quietly deleting it: a false justification for a correct decision is the exact defect class this ADR lineage exists to close, and the original claim was asserted from a source comment rather than executed.

## Decision

**Gate `check-types` on an explicit config-load preflight that runs in a process we own and sets its own exit code.**

New file `apps/web/scripts/preflight-config.mjs` dynamically imports `../next.config.js` inside `try`/`catch` and exits explicitly — `0` only after a completed, successful evaluation; `1` on any throw. The chain becomes:

```json
"check-types": "node scripts/preflight-config.mjs && next typegen && tsc --noEmit"
```

**Ordering is load-bearing.** The preflight runs FIRST, so the chain short-circuits before `next typegen` is ever invoked and therefore before it has a chance to swallow anything. Placed after typegen it would still fail the gate, but only after typegen had already run against a config it could not load, muddying the diagnostics.

`next typegen && tsc --noEmit` is deliberately left intact: typegen still legitimately produces the route types `tsc` consumes. The preflight **adds** a gate, it does not replace one — pinned by its own test.

### The guarantee this relies on, stated explicitly

Per the brief's requirement to name the guarantee: **the fix depends on no implicit process-termination semantics whatsoever.** The only guarantee invoked is that a dynamic `import()` of a module whose top-level evaluation throws returns a **rejected promise**, which is `await`ed inside `try`/`catch`. Every exit code is written out explicitly. The tests assert an **exit code** from a real child process, never an in-process exception — asserting `expect(() => ...).toThrow()` would be testing the very semantics that caused the defect.

### Default-deny

There is no path through the preflight that exits 0 without a successful config evaluation:

- Config throws → print and exit 1.
- Config evaluates but yields no default export → exit 1 rather than reading a degenerate config as a pass.
- **The preflight itself could not run** (`ERR_MODULE_NOT_FOUND`, `ERR_UNKNOWN_FILE_EXTENSION`, …) → exit 1, with a message pointing at the Node version. This arm matters because `packages/config` exports raw TypeScript (`"./env/web": "./src/env/web.ts"`), so this import transitively depends on native type-stripping — visible in the repro stack above. That is already pinned (`engines.node >= 22.18`, `.nvmrc` = `24`, CI `node-version-file: .nvmrc`), but a too-old Node must fail **closed**, not be mistaken for a pass. This is the same discipline ADR 1021 applies to `isLoopbackOrigin`: a guard that grants passage must never fail open.
- A backstop `process.on("unhandledRejection")` handler exits 1. This is belt-and-braces, not the mechanism — the awaited `try`/`catch` is the mechanism.

The preflight resolves the config relative to its own module URL, not to `cwd`, so it behaves identically under pnpm, turbo, or an absolute path from CI. Pinned by a test that runs it from the repo root.

## What was considered and rejected

- **`NODE_OPTIONS=--unhandled-rejections=strict` on `next typegen`.** **This works** — measured above, exit 1 at both throw sites, and it is what `web-native-skeleton` ships. Not rejected as inert (an earlier revision of this ADR wrongly claimed it was); rejected only as _weaker_, on three grounds: it covers the throw arm but not the empty-export arm or the preflight-cannot-run arm; it is carried in an inherited env var that any downstream wrapper can reset without a trace; and it couples the gate to Node's rejection-mode semantics, which the preflight does not touch. A future reader choosing the flag instead would get a **working** gate, just a narrower one — this bullet exists so nobody re-litigates it from a false premise in either direction.
- **Patching `@repo/config/env/web.ts` to `process.exit(1)` on validation failure.** Rejected: it would make a library module unilaterally kill any host process that imports it — including the Next dev server and the Vitest workers — and it would fix only the env-schema site, leaving the `assertTierInvariants()` site (finding 1) still swallowed.
- **Preflighting only `@repo/config/env/web` instead of the whole config.** Rejected: it closes one instance rather than the class. Importing `next.config.js` covers the env schema, `assertTierInvariants()`, and any config-load throw added later.
- **Restructuring the turbo `check-types` task** to declare `inputs`/`outputs`. Out of lane (`turbo.json` is another agent's file in this change), and unnecessary — see consequences.
- **A test asserting `next build` exits 1.** Deliberately not written. That is Next's behaviour, not ours, and no change of ours could redden it. Recording the measurement (finding 3) is worth more than a test that pins a third party.

## Consequences

- **The gate now fails on the value it exists to refuse.** Post-fix, measured: `API_URL="http://staging.internal:4000" pnpm run check-types` in `apps/web` exits **1** (pre-fix: 0). With a clean environment, `pnpm --filter web check-types` exits **0**.
- **Cheap in the failing case.** With a bad environment the chain short-circuits at the preflight, so `next typegen` and `tsc` never run — the end-to-end test costs a few seconds, not a full type-check.
- **Pinned by tests, with every disarm MEASURED rather than asserted** (`apps/web/scripts/preflight-config.test.ts`, 10 tests). Armed: **10/10 pass**. Three disarms were applied and re-run:

  | Disarm                                                 | Result                                                                      |
  | ------------------------------------------------------ | --------------------------------------------------------------------------- |
  | Revert `check-types` to `next typegen && tsc --noEmit` | **2 failed / 8 passed** (chain-shape + end-to-end)                          |
  | Make the preflight's catch arm `exit(0)`               | **4 failed / 6 passed** (both negative cases, cwd-independence, end-to-end) |
  | Make the preflight always `exit(1)`                    | **2 failed / 8 passed** (both positive controls)                            |

  The end-to-end test is the only one that reddens under **both** of the first two disarms, because it measures the property this ADR is actually about — the gate cannot be satisfied without running. The chain-shape test alone would not catch a broken preflight; the unit tests alone would not catch the script being reverted. The positive controls exist so the negative tests cannot pass by a preflight that always fails, and disarm 3 confirms they are not vacuous.

- **Turbo caching is unchanged, and that is acceptable.** `turbo.json`'s `check-types` declares `dependsOn: ["^build"]` with no `inputs` and no `outputs`, so a cache hit still skips the preflight — the gate remains cache-shaped. What saves it is that both `API_URL` and `APP_TIER` are in `globalEnv` (`turbo.json:51`, `:45`), so changing either busts the cache. Verified present; the task structure was deliberately not restructured (out of lane).
- **`SKIP_ENV_VALIDATION=1` still produces a green gate, and that is the designed escape hatch, not a hole.** A developer with it exported in their shell bypasses the env validation, hence the preflight. This is stated here so it is known rather than discovered. It is bounded: `assertTierInvariants` (`packages/config/src/env/assert-tier-invariants.ts:40`) refuses the flag outright on a prod-tier build, and the preflight inherits that refusal for free by importing the real config. The test suite deletes `SKIP_ENV_VALIDATION` (and `API_URL`) from the child environment before applying its own overrides, so an ambient value cannot make the negative tests pass for the wrong reason.
- **Scope: `apps/web` is the only affected workspace.** Every workspace `check-types` script was audited: `apps/api`, `apps/mobile` and all 14 `packages/*` are a bare `tsc --noEmit`, with no chained pre-step and nothing to swallow. `apps/web` was the sole exception. This audit is pinned by a test rather than left as prose, so chaining a swallowing pre-step onto another app reddens.
- **Correction to ADR 1021, which is OWED and NOT paid by this change.** ADR 1021 asserts that `web:check-types` "could not pass" pre-fix and "only ever passed via a turbo CACHE HIT" seeded by `SKIP_ENV_VALIDATION=1` runs, with CI riding "the same condition". The reproduction above disproves that account **in this tree**: the gate was green regardless of cache state, because it was not enforcing at all on the typegen path. The disproven prose still sits at these sites, all outside this change's lane:
  - `packages/config/src/env/web.ts:130-142` — the "TOO TIGHT" comment block.
  - `docs/adr/1021-api-url-https-gate-keys-on-loopback-not-node-env.md:19,42,48,49`.
  - `docs/adr/README.md:85` — the ADR 1021 row.

  Mercata corrected both of its equivalent source sites and booked that as PAID. Here it is booked as **OWED**, with exact file:line, because `packages/config/` was concurrently owned by another agent and ADR 1021 is a pre-existing ADR this change was instructed not to edit. The fix itself is correct and needed either way; only the reasoning about _why_ it matters changes.

- **Fleet exposure.** The hole is in the build script shape, so **every project stamped from this skeleton carries it**, and it looks like a working gate everywhere because it is green on every path — cold, forced, cached, and in CI alike. Derived repos should drain this. Mercata booked the defect (ADR 0125) but has no fix; it should take this one.
- **Generalisation.** ADR 1021 closed with "when a gate can be satisfied by a cache, it is not yet a gate." This is the sharper form: **a gate that can be satisfied WITHOUT RUNNING is not a gate at all, and a chained command only gates if its failure mode is an exit code.** A tool that reports failure on stderr and exits 0 is indistinguishable from success to `&&`, to `set -e`, and to CI. Where a gate delegates its enforcement to a third-party command, the exit code on the failing path is part of the security argument and must be MEASURED, not assumed — and the measurement must be repeated in each tree, because the upstream account of a symptom can be wrong.

## Sources

- [ADR 1021](1021-api-url-https-gate-keys-on-loopback-not-node-env.md) — the `API_URL` loopback rule this defect made unenforceable, and the source of the corrected cache-hit prose.
- [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) — the BFF proxy whose credential forwarding the `API_URL` rule protects.
- mercata ADR `0125-api-url-https-gate-keys-on-loopback.md` — books this defect as an out-of-scope follow-on and names the skeleton as the likely shared carrier; implements no fix.
- `next/dist/server/node-environment-extensions/unhandled-rejection.external.js:470-477` (Next 16.2.9) — the userland `unhandledRejection` listener that produces the exit-0 under Node's **default** mode. It does **not** survive `--unhandled-rejections=strict`; see the correction above.
- `web-native-skeleton` `apps/web/package.json` `check-types` — the `--unhandled-rejections=strict` variant, measured working on the same Next and Node.
- `apps/web/scripts/preflight-config.mjs`, `apps/web/scripts/preflight-config.test.ts`, `apps/web/package.json` (the `check-types` chain).
