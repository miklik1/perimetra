# ADR 1026 — the Stop-hook gate could not run its own command, and reported that as if the code were red

**Status:** Accepted (2026-07-20) — HQ-ruled default, Martin ratify queued (do-first doctrine, tooling lane).

**Provenance — mercata-originated, with NO skeleton lineage.** The defect was found and repaired in `mercata`, in commit `4409149` (`fix(tooling): the Stop-hook gate could not run its own command, and said so as if the code were red`, +88 lines, one file). **There is no mercata ADR to cite.** All 133 ADRs in `mercata/docs/adr/` were checked and none covers `claude-gate`, PATH resolution, or corepack; mercata's commit body states explicitly that it was split out of the ADR 0124–0132 security drain as "Stop-hook plumbing with no relationship to that change", and the justification lives entirely in that commit body and in unusually heavy in-file comments. **This ADR is therefore ORIGINATING documentation, not a port of an existing decision record.** The reasoning below is written for this repo; it is reconstructed from the upstream commit body and comments rather than copied from an upstream ADR, because no upstream ADR exists to copy.

## Context

`scripts/claude-gate.sh` is a live, registered Stop hook. `.claude/settings.json:8` wires it in:

```
"command": "bash \"$CLAUDE_PROJECT_DIR/scripts/claude-gate.sh\"",
```

Its contract is that Claude may not end a turn while the quality gates are red. It blocks the stop with exit 2 and feeds stderr back to the agent as instructions.

A gate's own **invocation path** is untested surface, and it fails in a uniquely bad way: when the invocation breaks, the gate does not report "I could not run". It reports green, or it blames the code. Both outcomes are worse than having no gate, because both are silently trusted.

### The defect, and the evidence it was live HERE

Before this change, `scripts/claude-gate.sh` went **straight from the green-state hash check to the invocation**, with nothing in between:

```
scripts/claude-gate.sh:25  [ -f "$green" ] && [ "$(cat "$green")" = "$state" ] && exit 0
scripts/claude-gate.sh:26
scripts/claude-gate.sh:27  out=$(pnpm turbo run check-types lint test --output-logs=errors-only 2>&1)
scripts/claude-gate.sh:28  if [ $? -eq 0 ]; then
```

and the only failure reporter in the file was the assertion-failure one:

```
scripts/claude-gate.sh:43  { echo "GATE FAILED — gates must be green before you stop:"
scripts/claude-gate.sh:44    printf '%s\n' "$out" | tail -60
scripts/claude-gate.sh:45    echo "Fix these failures, then finish your turn again."
scripts/claude-gate.sh:46  } >&2
scripts/claude-gate.sh:47  exit 2
```

That the whole repair was absent was verified mechanically, not by eye — the file was **byte-identical** to mercata's pre-fix version:

```
git -C /home/dchozen1/mercata show 4409149^:scripts/claude-gate.sh > /tmp/pre.sh
diff /tmp/pre.sh scripts/claude-gate.sh    # -> IDENTICAL
```

Two faults followed from that, and **both were live in this repo, on this machine** — not theoretical:

**(a) The gate could never resolve its own command.** A hook does not inherit an interactive shell's profile. Nothing between line 25 and line 27 touched `PATH`. On this box the real node is fnm-multishell-scoped at a path that exists only inside an interactive session (`/tmp/run-user-1000/fnm_multishells/…/bin/node`, v24.16.0) and is guaranteed absent from a hook's environment, while `/usr/bin/node` is **v12.22.9** — twelve majors behind `.nvmrc`, which pins a bare `24`. `package.json:37` pins `"packageManager": "pnpm@11.5.3"`, so `pnpm` is a corepack shim rather than a real binary. Reproduced under a hook-like environment:

```
$ env -i HOME=$HOME PATH=/usr/bin:/bin bash -c 'command -v node; node -v; command -v pnpm || echo "pnpm: NOT FOUND (exit $?)"'
/usr/bin/node
v12.22.9
pnpm: NOT FOUND (exit 1)
```

**(b) A tooling fault was reported as an assertion failure.** With no `pnpm` on PATH, `pnpm: command not found` landed in `$out` and was printed under the banner **"GATE FAILED — gates must be green before you stop"** (lines 43–47). There was no `tooling_fault` function and no second guard file anywhere in the file. The agent was told its code was red because a binary was missing, and sent hunting a bug that did not exist.

### Two further hazards that this fix INTRODUCES, and which are therefore constrained rather than found

The upstream finding lists four faults. It is important to be precise about their status here, because getting this wrong would misdescribe what the skeleton actually shipped:

- **(c) PATH priority inverted by the prepend loop — was NOT live here, and could not be.** There was no loop, no `PATH=` assignment and no `export PATH` in the file at all.
- **(d) Resolution gated on `command -v pnpm` rather than on the node major — was NOT live here, and could not be.** There was no resolution block to gate.

(c) and (d) are hazards **created by the fix for (a) and (b)**. They are constraints on how the repair is written and on what the tests must pin — not defects found in this skeleton. Reporting them as pre-existing bugs would be a false positive.

One related note on reading the upstream finding: its phrase "resolution is gated on `command -v pnpm` rather than on the node major" can be misread as describing mercata's _current_ state. It does not. In the repaired script the pnpm test is an additional **disjunct**, never the gate:

```sh
if ! command -v node … || [ "$major" != "$want" ] || ! command -v pnpm …; then
```

Keeping `! command -v pnpm` as an OR-arm is correct — it adds a trigger. Making it the sole or primary condition is the defect. The port preserves the OR shape exactly.

## Decision

Port mercata's repair verbatim, comments included, as a pure insertion between the green-state check and the invocation. The insertion is four pieces in a fixed order, each a precondition for the next: **(A)** a resolution trigger keyed on the node major, an ordered PATH prepend loop, and a corepack fallback; **(B)** a `tooling_fault()` reporter with its own release valve; **(C)** a cheap missing-`pnpm` check routed through it; **(D)** a node-major **post-condition assertion** immediately before the `pnpm turbo run` invocation.

**The node-major post-condition assertion (D) and the tooling-fault release valve (B) are ported TOGETHER. The assertion is what makes the PATH-ordering rule ENFORCED rather than merely documented; shipping the valve without the assertion re-opens faults (c) and (d).** This is the load-bearing sentence of this ADR and the reason the change is not divisible.

Additionally — and diverging from upstream — an automated test suite is added at `scripts/__tests__/claude-gate.test.sh`.

## Justification

### Why the assertion must exist at all

The assertion re-queries `node -v` **after** the prepend loop has run and compares its major against `.nvmrc`. It asserts the _realised outcome_ — the node that PATH now actually resolves — not "a node exists" and not "resolution was attempted".

It deliberately **repeats** the version comparison from (A)'s trigger, and that duplication is intentional and must survive review. The two are different in kind: (A)'s copy is a **predicate** ("should I try to fix PATH?"); (D)'s copy is a **post-condition** ("did the fix actually take?"). Deleting (D) as duplicated logic re-arms the defect, which is why the in-file comment carries an explicit anti-deletion notice and why a test now pins that comment's presence.

### Why (D) cannot ship without (B)

1. **(B) is (D)'s only correct reporting channel.** A failed post-condition is by definition a tooling fault — the code is fine, PATH is wrong. If (D) reported through the existing `GATE FAILED` path, the change would fix fault (a) while _deepening_ fault (b). (D) without (B) is a regression, not a fix.
2. **(B) is what makes (D) safe to enforce.** (D) can fire on a condition unfixable from inside the session — no node ≥24 installed anywhere, a read-only `$HOME`. Without (B)'s same-failure-twice release, (D) would block _every_ stop until Claude Code's 8-block cap: precisely the runaway that the script's own header (lines 6–11) declares it exists to prevent. A hard assertion with no release valve turns a PATH annoyance into a session deadlock.
3. **(D) is what makes (A)'s ordering rule enforced rather than documented.** The loop order — package-manager shim dirs first, node runtime dirs **last** — is counterintuitive, because each iteration _prepends_, so the last dir listed ends up highest priority. Reverse it and **every check the script performs still passes**: node exists, pnpm exists, the gate runs. The only symptom is a `SyntaxError` on modern syntax emitted _inside_ the corepack shim under `/usr/bin/node` v12.22.9 — which surfaces in `$out`, under the `GATE FAILED` banner, and reads as a broken repo rather than a broken PATH. (D) is the single mechanism converting that silent, misattributed mode into a legible message naming the version it actually found. Porting (A)'s loop without (D) ships the trap with no tripwire.

### The verified precondition the fix relies on

The fix depends on a correct toolchain being _reachable_ from a stripped environment on this machine. That was verified, not assumed: `$HOME/.local/share/fnm/node-versions/v24.16.0` and `v24.18.0` both exist, and `$HOME/.local/bin/pnpm` already exists as a corepack shim. The mercata-style smoke test confirms the repair end-to-end under a hook-like environment (probe = the real script truncated immediately before the `pnpm turbo run` invocation, so resolution and the assertion run for real while the repo gate is never executed):

```
$ printf '{"session_id":"smoke"}' | env -i HOME=$HOME PATH=/usr/bin:/bin \
    CLAUDE_PROJECT_DIR=/home/dchozen1/fullstack-skeleton bash probe.sh
RESOLVED node: v24.18.0
RESOLVED pnpm: /home/dchozen1/.local/share/fnm/node-versions/v24.16.0/installation/bin/pnpm -> 11.5.3
```

Worth recording honestly: node resolves from the `v24.18.0` directory while `pnpm` resolves from the `v24.16.0` one, because the `v24*` glob matches both and `pnpm` happens to be installed only in the older tree. Both are major 24, so the assertion passes and the resolved `pnpm` is the `11.5.3` that `packageManager` pins. This is benign, but it is a real cross-directory mix rather than a single coherent toolchain, and it is the kind of detail that would otherwise be rediscovered as a surprise.

## What was considered and rejected

- **Keying the resolution trigger on `command -v pnpm`.** Rejected: this is hazard (d), and it is the trap the upstream comments spend the most words on. Once corepack's shim has been installed into `~/.local/bin`, `pnpm` _is_ findable, so the whole block would be skipped and node never resolved — leaving the shim to run under whatever node PATH offers, typically a distro one far older than `.nvmrc`. The requirement was never "a pnpm exists"; it is "the toolchain `.nvmrc` pins is the one that runs". `! command -v pnpm` is kept, but strictly as an OR-arm.
- **Deleting the post-condition as duplicated logic.** Rejected for the reasons above; this is the single most likely future refactor to re-arm the defect, so it is defended twice — by an in-file anti-deletion comment and by a test that fails if that comment disappears.
- **Reporting tooling faults through the existing `GATE FAILED` reporter, to avoid a second code path.** Rejected: it is exactly fault (b). The two guard files (`/tmp/claude-gate-tooling-*` vs `/tmp/claude-gate-fail-*`) are likewise kept separate on purpose — merging them would let a tooling fault and a test failure cancel each other's release counter.
- **Paraphrasing or condensing the upstream comments.** Rejected. The comments are more than half the diff, and they are the deliverable as much as the code: they are what stops a future refactor from re-introducing (c) and (d). They are ported verbatim.
- **Reconciling `package.json`'s `"engines": { "node": ">=22.18" }` against `.nvmrc`'s `24`.** These disagree in this repo. Deliberately **not** touched: the assertion keys on `.nvmrc`, which is the stricter authority and the one version managers actually read. Changing `engines` would be a behavioural change riding in a tooling commit, and is out of this lane.
- **Wiring the test into the gate via root `package.json` / `turbo.json`.** Deferred, not rejected on merit — those are shared files another agent held concurrently. See Consequences.

## Consequences

- The gate now distinguishes **three** outcomes rather than two: **pass**, **assertion failure** ("the code is wrong" — `GATE FAILED`, exit 2), and **tooling fault** ("I could not run" — exit 2, explicitly disclaiming a code bug, and self-releasing on the second identical occurrence). All three are exercised by the test suite.
- A tooling fault that the agent cannot fix from inside the session costs one blocked stop, then releases with a `systemMessage`, matching the test path's existing defense-in-depth rather than deadlocking to the 8-block cap.
- **This skeleton adds an automated test where mercata verified by hand.** That divergence is deliberate and specific to being a skeleton: this repo is copied into new projects, so a manual recipe recorded only in a commit body does not survive the copy. The consequence to accept is that `scripts/__tests__/claude-gate.test.sh` has **no upstream counterpart** and cannot be reconciled against mercata on future drains.
- The suite was verified to actually RED rather than to merely pass, by mutation (each mutant is a copy outside the repo, selected via `CLAUDE_GATE_PATH`): resolution block deleted → 16 failures; post-condition deleted → 6; loop order reversed → 22; trigger keyed on pnpm → 2; release valve removed → 4; tooling fault routed to `GATE FAILED` → 5; rationale comments stripped → 3. Baseline **at the time of this ADR**: 38 passed, 0 failed. **The mutant counts and that 38-baseline are a point-in-time record and are NOT re-measured here** — [ADR 1029](1029-the-guards-were-guarding-nothing.md) later rewrote and extended this suite (order-discriminating corepack layout, missing-`.nvmrc` tooling fault, per-run unique ids), so the mutant deltas above no longer reproduce against the current suite. Current baseline, re-measured 2026-07-20: **44 passed, 0 failed**.
- **The test is gate-enforced (wired 2026-07-20 by the serialized repair phase).** It was not, at the time of the original change, because root `package.json` was concurrently held — an accepted risk recorded rather than hidden. It is now `pnpm test:scripts`, invoked from the CI `lint` job (`Repo script tests`) and from lefthook `pre-push`. It is deliberately NOT a turbo task: `turbo run test` only reaches vitest suites inside workspaces, and the subject here is a bash script exercised under `env -i` with a curated PATH — modelling that as a workspace would be ceremony around a 0.5s script. Wiring proven both ways: the repo-level `pre-push` run executes all **44** assertions (38 when this ADR was written; raised to 44 by [ADR 1029](1029-the-guards-were-guarding-nothing.md), re-measured 2026-07-20), and breaking one assertion turns that same run red (exit 1) before it was restored. Leaving it unwired would have been self-refuting, since the defect this ADR closes is precisely a gate that only appears to run.
- **Known limitation, inherited from upstream and deliberately not fixed here:** the post-condition is guarded by `[ -n "$want_major" ]`, so an **absent or empty `.nvmrc` silently disables the assertion entirely** and the gate proceeds on whatever node it found. This skeleton always ships a `.nvmrc`, so it is latent rather than live. Diverging from mercata to fix it was judged out of scope for a port.
- **Known limitation, inherited:** the prepend loop enumerates six version-manager layouts (pnpm home, `~/.local/bin`, volta, asdf, nvm, fnm). A box using something else — nix, homebrew, a container image with node in `/usr/local/bin` — matches no candidate dir. This does **not** produce a false stop-block, because the post-condition compares the _resolved_ major: a correct pre-existing node passes cleanly. That property is not left to argument; it is pinned by test case 9.
- **Known limitation, inherited:** `/tmp/claude-gate-tooling-${session}` is keyed on session id only, not on repo, so two skeleton-derived repos worked in one Claude session share a guard. Mercata has the same property on both guard files. Inherited rather than introduced, and not fixed unilaterally here; it is a legitimate skeleton-level improvement to stack for later.
- Generalisation worth carrying: **a gate that cannot run its own command is not a gate, and the failure mode is not silence but misattribution.** The invocation path of any enforcement tool needs the same scrutiny as the thing it enforces — and where a rule is counterintuitive enough that reversing it still passes every check (here, the prepend order), the rule needs a post-condition asserting the realised outcome, not a comment.
