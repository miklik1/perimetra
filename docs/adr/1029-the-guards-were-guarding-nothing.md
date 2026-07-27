# ADR 1029 — The guards shipped by the security wave were not themselves guarded

**Status:** Accepted (2026-07-20) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Repairs the tooling landed by [ADR 1026](1026-the-stop-hook-gate-could-not-run-its-own-command.md) and [ADR 1028](1028-gitleaks-pinned-by-sha256-digest.md), and amends the durable-record sweep those ADRs claimed. No product behaviour changes.

## Context

The preceding wave landed two pieces of repo-resident tooling — `scripts/claude-gate.sh` (the Stop-hook quality gate) and `scripts/check-gitleaks-pin.mjs` (the supply-chain pin guard) — each written around a single thesis: **a control that is verified once by a human, and whose weakening reddens nothing, is not a control.** An adversarial review of the wave applied that thesis to the wave's own output. It held in six places — and then, at land time, in a seventh: this ADR's own repair for the sixth (see (h)).

### (a) The PATH-order test did not test PATH order

`scripts/__tests__/claude-gate.test.sh` case 3 was named "PATH order — the pinned node outranks an older one already on PATH" and carried an in-file comment claiming it "REDs if the loop order in the resolution block is reversed". It did not. The stale node was placed on the plain inherited PATH, which **every** candidate dir outranks by construction — all of them are prepended — so the loop's internal order was never observed at all.

Measured, not reasoned: with the six-line `for dir in …` list reversed in a mutant copy, the suite reported **38 passed, 0 failed**. The test advertised catching exactly the refactor it green-lit.

The layout that discriminates is the ordinary corepack + distro-node one: `$HOME/.local/bin` holds both the corepack `pnpm` shim **and** a node. `.local/bin` is listed early in the loop, i.e. deliberately low priority; the version-manager dirs are listed last and must win. Reverse the order and the shim executes under the stale node — which surfaces as a `SyntaxError` on modern syntax _inside the shim_, reading like a broken repo rather than a broken PATH. That is the precise silent mode the ordering rule exists to prevent.

### (b) The node-major post-condition failed open on a missing `.nvmrc`

The post-condition asserting the resolved node against `.nvmrc` was guarded by `[ -n "$want_major" ]`. With no `.nvmrc`, `want_major` is empty, the comparison is skipped entirely, and the gate proceeds. Executed against a fixture with `.nvmrc` removed and only a node v12.22.9 available: the gate ran `pnpm turbo run …` under **v12.22.9** and exited **0** — a green Stop hook from a toolchain nothing had verified. A project generated from this skeleton that renames or drops `.nvmrc` loses the pin without a line of output saying so.

The release valve exists for exactly this shape: `tooling_fault` reports once and, on a repeat, releases the stop. There was never a reason to prefer a silent skip.

### (c) The script suite was not concurrency-safe

The suite used hard-coded session ids (`t-c1`…`t-c9`) for the gate's `/tmp` loop-guard files and wildcard-deleted `/tmp/claude-gate-tooling-t-*` and `/tmp/claude-gate-fail-t-*` at **every** `begin()`. Two simultaneous runs on one host therefore deleted each other's guard files mid-case — a **false RED** in exactly cases 6/7/8, the three that assert on guard-file existence.

Not hypothetical: CI's concurrency group is event-scoped, so a push run and the Monday schedule run are not collapsed, and on the self-hosted runner of [ADR 1007](1007-ci-self-hosted-runner-default.md) they share one `/tmp`. Executed: three concurrent runs of the old form reported **33/44, 40/44, 34/44** — three independent false failures from one correct script. A gate that fails randomly is a gate people learn to re-run rather than read.

### (d) The pin guard had no tests, while its own header cited them

`scripts/check-gitleaks-pin.mjs` carries a header comment referring to "this guard's own mutation tests" and an env override (`CI_WORKFLOW_FILE`) whose stated purpose is to serve them. The mutations were run ad hoc in a scratch dir and never committed. So the guard occupied the position it was written to eliminate: loosening the `curl | tar` regex, deleting the `verifyIdx > extractIdx` ordering check, or dropping the digest-format assertion reddened nothing while the guard kept printing `gitleaks pin OK`.

### (e) The `shell:` tripwire was file-global and misattributed

The errexit tripwire ([ADR 1028](1028-gitleaks-pinned-by-sha256-digest.md) precondition 2) matched `^\s*shell:` anywhere in `ci.yml`. Executed: adding `defaults.run.shell: bash` to the **`lint`** job — a step that cannot touch the pin — reddened the guard with a message instructing the reader to "re-verify the gitleaks step". A rule that fires on unrelated edits and then misdiagnoses them is the cheapest possible invitation to delete the rule, and deleting it costs the real protection.

### (f) The Stop-hook gate did not run the tests that guard it

`claude-gate.sh` ran `pnpm turbo run check-types lint test`, which reaches only tasks declared inside workspaces. It could therefore never reach `pnpm test:scripts` — the suite whose entire purpose is protecting `claude-gate.sh` — nor `pnpm check:gitleaks-pin`. An agent that broke the gate and stopped got a **green** Stop hook; the break surfaced a full feedback cycle later, at pre-push or in CI.

### (g) Two durable records still described the superseded secret scan

`docs/adr/0044` describes the gitleaks gate as `gitleaks-action@v3` with an incoming-range scan on PR/push and full history only on `workflow_dispatch` (`:35`, and the `GITLEAKS_LICENSE` note at `:75`). Both halves are false of the repo today. ADR 1028 knew this and left 0044 alone on the principle that "ADRs are superseded, not edited" — but left **no forward pointer**, which is not superseding, it is abandoning: a superseded record with no link is indistinguishable from a current one. Meanwhile `SECURITY.md`'s supply-chain section cited 0044 as its baseline while its own table correctly contradicted it.

_(The reviewer additionally reported that ADR 1028 claims to have corrected every instance of the stale claim. That is refuted: 1028's text explicitly names `SECURITY.md:131` and the `ci.yml` comment as the corrected instances and explicitly carves out 0044. The claim was narrow, not false. It has been amended anyway, because the carve-out's justification no longer holds once a pointer is added.)_

### (h) …and then decision 6 of this ADR was itself unpinned

Found at land time, by applying this ADR's own thesis to this ADR's own output. Decision 6 below adds `pnpm check:gitleaks-pin` and `pnpm test:scripts` to `claude-gate.sh` — the whole repair for defect (f). Nothing pinned it. Measured: with both lines deleted from `claude-gate.sh`, `scripts/__tests__/claude-gate.test.sh` reported **44 passed, 0 failed**. The suite that exists to protect the gate could not see the gate's own guards being removed.

Case 1 came close and stopped short — it asserts `pnpm invoked: turbo run check-types lint test` and never looks for the other two invocations, even though the stub logs every one of them. That is the (a)/(d) shape a third time: the evidence was sitting in the fixture's log file, unread.

Three properties are now pinned, not one, because the obvious single assertion ("the commands appear in the log") is defeated by two edits that leave the log identical: reordering the guards after the turbo tasks, and ignoring their exit codes. So: both guards are invoked; both precede the turbo tasks; and a guard that REDs blocks the stop with `GATE FAILED` and short-circuits before turbo runs.

## Decision

1. **Rebuild case 3 around the corepack layout** — a node in `$HOME/.local/bin` (a low-priority candidate dir) alongside the `pnpm` shim, versus the pinned node in the fnm dir. The loop order is now observable, and reversing it REDs.
2. **A missing or unreadable `.nvmrc` is a `tooling_fault`**, not a skip. The gate refuses to run `pnpm` under an unverified toolchain; the same-failure-twice release keeps a genuinely `.nvmrc`-less repo from deadlocking. Pinned by a new case 10.
3. **Per-run unique session ids** (`t-$$-<epoch>-<rand>-cN`) and cleanup confined to that namespace. No wildcard reaches another run's files.
4. **Commit the pin guard's mutation tests** as `scripts/__tests__/check-gitleaks-pin.test.sh` — **27** cases, each mutating the real `ci.yml` and asserting both that the guard REDs and that its message **names the control** rather than a downstream symptom. A baseline case asserts the unmutated file passes, without which every mutant assertion could pass vacuously.
5. **Scope the `shell:` tripwire to the `gitleaks:` job**, sliced line-wise. Both directions are pinned: a `shell:` on the install step or as a job-level `defaults.run` REDs; a `shell:` in another job does not. A third case REDs if the job is renamed, so the scoping cannot silently degrade into "inspects nothing, always green".
6. **The Stop-hook gate runs `check:gitleaks-pin` and `test:scripts`** before the turbo tasks, cheapest first. `test:scripts` now runs both suites. **Pinned by cases 12a–12c** (invoked · ordered before turbo · a red guard blocks and short-circuits), added after decision 6 was measured to be unpinned — see (h).
7. **Repair the durable record**: 0044 gets a "Partially superseded — the secret-scan gate only" note pointing at 1028, body untouched; 1028's sweep paragraph is amended to say what it actually covered; `SECURITY.md` cites "ADR 0044, as amended for the secret scan by ADR 1028".

Deliberately **not** decided here: `SECURITY.md`'s telemetry section still documents only the Sentry scrubber and says nothing about the second, separate PostHog analytics sink. That omission is real and is owed to any downstream repo, but the analytics scrub's own architecture is being replaced rather than iterated (the fail-closed re-architecture that follows this ADR), and a `SECURITY.md` entry describing the superseded enumerate-the-modelled-shapes design would be a durable record of a design that never shipped. The entry is written by the ADR that lands the replacement, not by this one.

## Cost, measured

Adding two commands to the Stop hook was weighed rather than assumed. Measured on this box, three runs: `check:gitleaks-pin` **0.02 s** (static, offline by design), `test:scripts` **1.16–1.20 s** (hermetic bash, no network, no install) — about **1.2 s** of added wall clock plus pnpm's spawn overhead. Against a turbo-cached `check-types lint test` measured in seconds, and an uncached one in tens of seconds, that is noise. It is also paid only on runs that reach that point at all: the no-change, markdown-only and green-state-hash skips all return earlier. Accepted deliberately.

## Disarm verification

Every rule added here was disarmed and observed to RED. Nothing below was reasoned from the code.

| Rule                                      | Disarm applied                                          | Result                            |
| ----------------------------------------- | ------------------------------------------------------- | --------------------------------- |
| case 3 pins the loop order                | reversed the six-dir `for dir in …` list                | **RED** 41/44 (was 38/38 green)   |
| missing `.nvmrc` is a tooling fault       | restored the `[ -n "$want_major" ]` fail-open guard     | **RED** 40/44                     |
| suite is concurrency-safe                 | 3 concurrent runs of the hard-coded-id form             | **RED** 33/44, 40/44, 34/44       |
| ↑ same, after the fix                     | 3 concurrent runs of the committed form                 | **GREEN** 44/44 ×3, no leftovers  |
| pin guard: `curl \| tar` detection        | replaced the regex with `if (false)`                    | **RED** 25/27                     |
| pin guard: verify-before-extract ordering | replaced `verifyIdx > extractIdx` with `false`          | **RED** 26/27                     |
| pin guard: digest format assertion        | replaced the 64-hex test with `false`                   | **RED** 26/27                     |
| `shell:` tripwire is scoped, not global   | `shell:` added to the `lint` job / to the gitleaks step | **GREEN** / **RED** respectively  |
| gate runs its own guards (before the fix) | deleted both guard lines from `claude-gate.sh`          | **GREEN** 44/44 — disarm survived |
| ↑ same, after cases 12a–12c               | deleted both guard lines from `claude-gate.sh`          | **RED** 46/56                     |

## Consequences

- The Stop hook is ~1.2 s slower on runs that reach the test phase, and correspondingly harder to leave broken.
- `pnpm test:scripts` is now two suites. Both are hermetic — no network, no install, no Docker — so they remain safe in every path that runs them (CI lint job, lefthook pre-push, Stop hook).
- The pin guard is scoped to a job name (`gitleaks:`). Renaming that job REDs with an actionable message rather than silently disabling the check; that is the intended trade for the narrower match.
- **Generalisation, and the one worth carrying forward:** _a test that cannot be shown to RED is a comment._ Defects (a), (d) and (h) took the same form — a control whose verification existed as an assertion in prose. The mutation table above is the deliverable, not the passing suite; a suite that has never been disarmed reports nothing about the code, only about itself.
- Defect (h) is the sharpest instance and worth stating separately: **the repair for a defect is new unguarded surface, and the review that found the defect does not automatically cover its own fix.** Decision 6 was written, reviewed, and shipped into a working tree, and the property it establishes was unpinned the entire time. The only thing that caught it was re-running the disarm procedure against the landed tree rather than trusting the ADR's account of it. Disarm at land time, not at write time.
- Not addressed here, and left open deliberately: `--verify-download` still requires a human to run it when bumping the pin. The ledger remains a tripwire, not an oracle ([ADR 1028](1028-gitleaks-pinned-by-sha256-digest.md)).

## Sources

- Adversarial panel review of the 2026-07-20 security-defect port wave (findings G1–G8).
- [ADR 1026](1026-the-stop-hook-gate-could-not-run-its-own-command.md), [ADR 1028](1028-gitleaks-pinned-by-sha256-digest.md), [ADR 1007](1007-ci-self-hosted-runner-default.md), [ADR 0044](0044-security-baseline-supply-chain.md).
