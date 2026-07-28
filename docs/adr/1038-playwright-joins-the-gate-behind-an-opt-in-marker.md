# ADR 1038 — Playwright joins the Stop-hook gate, behind an opt-in marker

**Status:** Accepted (2026-07-27). Extends the gate landed by
[ADR 1026](1026-the-stop-hook-gate-could-not-run-its-own-command.md) and guarded
by [ADR 1029](1029-the-guards-were-guarding-nothing.md). No product behaviour
changes; one new root script and one new, default-off gate step.

## Context

The repo has a mock-mode Playwright suite (`apps/web/e2e`, ADR 0025) and a CI job
that runs it. Between those two facts sits a gap that was measured rather than
assumed: **nothing local runs it.**

- `scripts/claude-gate.sh` ran `check:gitleaks-pin`, `test:scripts` and
  `turbo run check-types lint test`. None of those reaches Playwright.
- `pnpm test` is `turbo run test`, and `turbo.json` declares no `test:e2e` task,
  so the e2e suite is unreachable from the task graph by construction.
- Neither `lefthook.yml` pre-commit nor pre-push invokes it.

The consequence is specific and it has a shape this repo has seen before: a wave
that reskins the web surface passes every local gate, gets pushed, and only then
turns the `e2e-web` job red. The feedback arrives a full cycle late — after the
push, in a job the author has already stopped watching — which is exactly the
"the gate you run locally is not the gate CI runs" class recorded on 2026-07-10.

The obvious fix — run the suite on every gate — is wrong, and the numbers say so.
The gate fires on **every stop**, which on an agent seat means many times an
hour. Measured on this box, the mock-mode suite is **6 tests / 9.1 s** with a
warm `.next` and a `next dev` boot; cold it is considerably worse. Nine seconds
of browser and dev-server per stop, paid by every project stamped from this
skeleton whether or not it touches the web surface, is a tax nobody agreed to.
The suite is worth its cost on a web-surface wave and worth nothing on a backend
one, and the gate has no way to tell those apart — but the person or agent
starting the wave does.

There is a second, sharper hazard. `playwright.config.ts` sets
`reuseExistingServer: !process.env.CI`, so on a shared multi-seat box a run that
does not claim a port **silently drives whatever app already owns :3000**. Routes
and UI are identical across derived repos, so the specs go green against the
wrong app. The config and `apps/web/e2e/README.md` both document this as the
port-ownership trap ([ADR 1012](1012-e2e-web-port-multiseat.md)), and it has
already produced a false-green run in this fleet. A gate step is the worst
possible place to walk into it: nobody reads a gate's output when it is green.
The first draft of this ADR then walked into it anyway, with a single shared port
constant — see _The port constant was the same hazard, automated_ below.

## Decision

1. **A root `test:e2e` script**, `pnpm --filter web test:e2e`, and the gate calls
   **that** rather than spelling the filter out inline. This is load-bearing, not
   cosmetic. The selftest's selective-failure stub reddens a single step by
   matching on `$1` — the pnpm subcommand — and a bare
   `pnpm --filter web test:e2e` puts `--filter` in `$1`. A `--filter`-shaped gate
   line therefore cannot be disarm-tested at all: no case can redden it without
   reddening every other step too. Naming the step makes it observable, and
   anything unobservable in this file has historically gone unpinned.

2. **The step goes LAST in `gate_commands()`**, after the turbo tasks, mirroring
   the existing cheapest-first order. It is the only step that boots a browser
   and a dev server; nothing after it would ever run on a red one anyway.

3. **Opt-in, and OFF by default**, for the cost reason above:

   ```bash
   if [ -n "${CLAUDE_GATE_E2E:-}" ] || [ -f .git/claude-gate-e2e ]; then
     WEB_PORT="${CLAUDE_GATE_WEB_PORT:-$(gate_web_port)}" WEB_E2E_OWN_SERVER=1 \
       pnpm test:e2e 2>&1 || return 1
   fi
   ```

4. **The marker file is the primary switch; the env var is the one-off.**
   `.git/` is never committed, and the gate already writes `.git/claude-gate-green`
   there — both the path and the `.gitignore` posture are proven by a mechanism
   that has been running for weeks, so the marker introduces no new question
   about what might accidentally be committed. It also survives across the many
   short-lived shells an agent session spawns, which an exported variable does
   not: a seat arms a wave once with `touch .git/claude-gate-e2e` and disarms it
   by deleting the file. `CLAUDE_GATE_E2E` remains for a manual one-off run and
   for the selftest, which needs to exercise the branch without writing to a
   fixture's `.git/`.

5. **The run must OWN the server it drives** — a per-checkout `WEB_PORT` plus
   `WEB_E2E_OWN_SERVER=1`, both mandatory on that line. This is the
   `reuseExistingServer` hazard above; see _The port constant was the same hazard,
   automated_ below for why the first draft's single constant did not close it.

6. **Pinned by seven selftest cases (13a–13d, 14a–14c)** in
   `scripts/__tests__/claude-gate.test.sh`: armed-and-green (invoked, ordered
   after turbo, on a port that is neither the default nor unset), unarmed (**not**
   invoked — this is the case that pins the DEFAULT), armed-and-red (exit 2,
   reported as `GATE FAILED` and never as a tooling fault), env-armed, then the
   port's derivation, the override, and fail-closed. Each survives the mutation
   that defeats the others; the table below is the evidence.

7. **Not added to `turbo run test`, and not added to lefthook pre-push.** Both
   playwright configs state the reason in-file: browsers plus a dev server make
   the task non-deterministic to cache, so a `test:e2e` turbo task would either
   be cached wrongly or poison the cache key for everything downstream. CI
   already runs `e2e-web` on PRs, schedule and dispatch under
   [ADR 1003](1003-ci-cadence-fast-gates-push-heavy-scheduled.md)'s per-push gate. The gate flag is the
   **local, per-wave complement** to that CI job, not a replacement for it.

8. **The eyes-on harness is documented, not reinvented.**
   `apps/web/e2e/README.md` now carries the throwaway-Playwright recipe — a sweep
   over named fixture _states_ x five viewport bands, a screenshotted tab-walk,
   `scrollWidth - clientWidth` measured per band **and** per section, and the
   instruction that the PNGs must actually be read back. It is written as a
   scratchpad throwaway that must never become a committed spec, and it carries
   the standing traps: a green DOM assertion is not evidence the user can see the
   field; a fixed bottom overlay intercepts pointer events; never edit the tree
   while a suite runs; never `pkill -f`, kill the PID bound to the port.

## The port constant was the same hazard, automated

This ADR's first draft wrote `WEB_PORT="${CLAUDE_GATE_WEB_PORT:-3199}"` and called
the hazard closed. An adversarial review of the wave proved otherwise, and the
correction belongs in this ADR rather than a successor because the defect was
introduced here.

**3199 was ONE CONSTANT** — identical in this skeleton and in web-native-skeleton,
inherited unchanged by every project stamped from either. `reuseExistingServer:
!process.env.CI` was untouched and a Stop hook does not set `CI`, so on a
multi-seat box — this fleet's normal state — whichever gate armed second found
:3199 already bound and Playwright **reused it**. Both skeletons ship
near-identical specs (`/`, `/login`, `/account`, the same Czech 404 strings, and
this very wave added the same `/not-found-probe` route to both), so seat B's suite
passes green against seat A's application. Demonstrated in review, and reproduced
here: a foreign HTTP server bound to the port, then the Playwright run reused the
foreign listener instead of booting `next dev`, and the specs ran against the
impostor.

That is exactly the silent-substitution class [ADR 1012](1012-e2e-web-port-multiseat.md)
was written to prevent — and it is **strictly worse than the case ADR 1012
addresses**, because 1012's failure needs a human to forget `WEB_PORT`, while this
one fired automatically, on every armed stop, in a step whose output nobody reads
when it is green. Naming the hazard in a comment while shipping the mechanism that
triggers it is the whole defect: _the port number was the lesser half; the real
one was that the run was allowed to silently reuse a server it did not start._

**Both halves are fixed.**

**(a) Fail closed.** `WEB_E2E_OWN_SERVER=1` on the gate's e2e line, and
`playwright.config.ts` computes
`reuseExistingServer: !(process.env.CI || process.env.WEB_E2E_OWN_SERVER)`.
Measured, Playwright 1.60, both skeletons' real configs, foreign HTTP server on
the wait-URL:

| Run                                | What actually happened                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| reuse-true (the shipped default)   | never booted `next dev`; ran all 6 specs against the impostor; reported its own verdict |
| `WEB_E2E_OWN_SERVER=1` (or `CI=1`) | `Error: http://localhost:PORT is already used …` — **exit 1, zero tests run**           |
| `WEB_E2E_OWN_SERVER=1`, port free  | booted its own server, suite ran normally, exit 0                                       |

**It is deliberately NOT `CI=1`,** even though `CI=1` produces the identical
refusal. Measured, `CI` is a bundle: `forbidOnly` false→true, `retries` 0→1,
`workers` parallel→1, reporter `list` → `[github, html]` — which emits
`::error ::`/`::notice` workflow commands into the very text the gate feeds back
to Claude on failure, and writes `apps/web/playwright-report/index.html` on every
armed stop — and `CI` leaks into the `next dev` child, so the app under test would
boot in a mode no developer runs. Four unrelated behaviour changes, two of them
making the gate slower and one making its failure output noisier, to buy one
boolean. The targeted knob changes exactly the one thing.

**(b) A per-checkout port.** `gate_web_port()` is
`sha1(pwd -P)[0:8] mod 4536 + 61000`.

- **Deterministic and stable per checkout** — same repo, same port every run, so a
  leftover listener from the repo's own previous run is recognisably its own.
- **Different per checkout** — sibling clones and git worktrees differ. The
  **physical path** is the right key precisely because a worktree shares a remote
  and a HEAD lineage but never a path, and worktrees are this fleet's normal
  multi-seat topology. (Measured spread on this box: fullstack-skeleton 64921,
  web-native-skeleton 62555, perimetra 61975, anyora-platform 62024.)
- **61000–65535** — inside IANA's dynamic/private range **and above** Linux's
  default ephemeral allocation range (`net.ipv4.ip_local_port_range` = 32768–60999
  on this box), so the kernel never hands one of these to an outbound socket. Had
  the range merely been "ephemeral", a derived port could collide with a transient
  outbound connection — which after (a) is a loud false red rather than a silent
  false green, but a false red all the same.
- `CLAUDE_GATE_WEB_PORT` still overrides, and is now pinned by a case.

A hash maps two distinct checkouts onto one port **once in 4536 pairs** — with
six seats on a box, about a 0.3 % chance some pair shares one. That is now a
_loud_ outcome (the second gate refuses to start and names the port) rather than a
silent one, and the override is the one-line fix. Case 14a is deliberately
collision-TOLERANT for the same reason: it tries up to three sibling checkouts and
asserts that _some_ sibling differs, so a 1-in-4536 draw cannot false-RED a suite
the Stop hook runs on every stop, while a port that ignores the checkout still
reds all three.

**Deliberately not decided:** whether a `.claude/settings.json` `"env"` block
reaches Stop-hook processes. That would be a tidier place to arm a project than a
marker file, but it is **unmeasured**, and a design that depends on an unverified
harness behaviour is the same shape as a test that has never been disarmed. The
marker file needs no such assumption. If someone measures it, this ADR can be
superseded.

## Cost, measured

| Step                                    | Measured                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| mock-mode e2e suite, warm `.next`       | 6 tests, **9.1 s**, on a claimed port                                                        |
| the same step, unarmed                  | **0 s** — the `if` is not entered                                                            |
| the seven new selftest cases            | **+0.7 s** — 0.78/0.82/0.93 s at HEAD → 1.54/1.59/1.63 s with 13a–13d and 14a–14c (n=3 each) |
| the run refusing a port it does not own | **exit 1 before any browser starts** — 0 s of e2e                                            |

The +0.7 s is paid on every stop that reaches the test phase, because
`test:scripts` is a gate step. Most of it is case 14's four extra gate
invocations plus binding one real socket; it buys the only assertion in the file
that can distinguish "the gate ran the suite" from "the gate ran **a** suite,
against someone else's application".

The real-stack `@smoke` suite (`playwright.smoke.config.ts`) stays **out** of the
gate entirely: it needs `docker compose` up and a running api, and a Stop hook
must never assume infrastructure it did not start, nor start infrastructure the
developer did not ask for.

## Disarm verification

Run against the **landed** files, not the drafts — [ADR 1029](1029-the-guards-were-guarding-nothing.md)
defect (h) is the precedent, where a repair shipped unpinned because the
procedure was run at write time. Each mutant was built from the landed
`scripts/claude-gate.sh` and driven through `CLAUDE_GATE_PATH`, so the tracked
file was never edited.

| Disarm applied to the landed gate                                  | Selftest result |
| ------------------------------------------------------------------ | --------------- |
| _baseline, unmutated_                                              | **GREEN** 84/84 |
| the whole e2e step deleted                                         | **RED** 69/84   |
| the step made unconditional (`if` guard removed)                   | **RED** 83/84   |
| `\|\| return 1` weakened to `\|\| true` (present, toothless)       | **RED** 78/84   |
| the `WEB_PORT=` prefix dropped                                     | **RED** 74/84   |
| the `CLAUDE_GATE_E2E` half of the condition removed                | **RED** 82/84   |
| the step moved to the FRONT of `gate_commands()`                   | **RED** 83/84   |
| **the port re-hardcoded to a fleet-wide 3199**                     | **RED** 80/84   |
| **`WEB_E2E_OWN_SERVER=1` dropped from the step**                   | **RED** 79/84   |
| **the `CLAUDE_GATE_WEB_PORT` override removed**                    | **RED** 83/84   |
| **the port keyed on something other than the checkout (constant)** | **RED** 83/84   |
| **the port randomised per run instead of derived**                 | **RED** 80/84   |
| **config `reuseExistingServer` back to `!process.env.CI`**         | **RED** 83/84   |
| `pnpm test:scripts` deleted (regression control)                   | **RED** 79/84   |

The one-assertion reds are the point, not a weakness: each names exactly the
property that was disarmed. The unconditional mutant reds **only** case 13b,
which is why 13b exists — without it, taxing every stop in every derived project
would have been a silent change. Likewise the last five rows: the two
port-derivation mutants red on _different_ assertions (a constant kills
"a sibling checkout differs"; a random port kills "the same checkout is stable"),
and dropping `WEB_E2E_OWN_SERVER=1` leaves **every port assertion green** — which
is precisely why fail-closed is a case of its own rather than a rider on 14a.

**How case 14c proves fail-closed without running a browser.** The gate is bash;
Playwright is not. So the case binds a **real** TCP listener on the port the gate
itself chose (read back out of the invocation log, never recomputed by the test —
it cannot pass by agreeing with itself), and the `pnpm` stub is an executable
statement of Playwright 1.60's **measured** `webServer` contract: occupied port +
ownership declared → refuse and exit 1; occupied port + no declaration → drive the
foreign server and exit 0. The stub's fidelity is the measurement table above,
re-run against both skeletons' real configs; the case's job is to prove the gate
passes the flag that selects the first branch. Drop the flag and the run goes
green against the impostor — which is the RED in row 9. The config half is
additionally held by a text tripwire (row 13), driven through
`CLAUDE_GATE_PW_CONFIG` the same way the gate mutants are driven through
`CLAUDE_GATE_PATH`. **Re-measure the stub's contract on a Playwright major bump.**

## Consequences

- A web-surface wave arms the gate once (`touch .git/claude-gate-e2e`) and gets
  Playwright feedback at every stop instead of at the next CI run. A backend wave
  pays nothing.
- The default is unchanged for every existing project: no marker, no e2e, no new
  wall clock. Draining repos inherit an off switch, not a bill.
- **A repo draining this ADR must do four things, and the last two are the ones
  that get skipped:** add the root `test:e2e` script (without it the gate line
  runs nothing and the disarm tests are meaningless); copy the gate step verbatim
  including `gate_web_port()`, the `WEB_PORT` prefix and `WEB_E2E_OWN_SERVER=1`;
  take the `reuseExistingServer: !ownServer` expression into
  `apps/web/playwright.config.ts` (the flag does nothing without it, and nothing
  fails); and port cases 13a–13d **and 14a–14c**. A step without its cases is the
  "present but toothless" mutation shipped deliberately.
- **A derived project inherits a port DERIVATION, not a port.** Nothing to
  allocate, nothing to write down, nothing to keep in sync across repos — and no
  constant for the next skeleton to copy. A gate that lands on an occupied port
  now says so and blocks the stop; `CLAUDE_GATE_WEB_PORT` is the escape hatch.
- If a derived project renames `apps/web` or its `test:e2e` script, the gate step
  fails loudly (`pnpm` exits non-zero → `GATE FAILED`) rather than silently
  skipping. That is the intended direction of failure.
- The eyes-on recipe now has one home. It was being reinvented per project, each
  time missing a different half — usually the per-section overflow measure, or
  the instruction to actually open the screenshots.

## Sources

- 2026-07-24 finding: Playwright suites must join the gate for web-surface waves.
- 2026-07-20 finding: the throwaway-Playwright eyes-on pattern is reinvented per project.
- [ADR 1012](1012-e2e-web-port-multiseat.md) — the multi-seat port-ownership
  class. This ADR's first draft re-created it automatically; the correction above
  closes both halves (own the server, derive the port).
- [ADR 1026](1026-the-stop-hook-gate-could-not-run-its-own-command.md),
  [ADR 1029](1029-the-guards-were-guarding-nothing.md),
  [ADR 1003](1003-ci-cadence-fast-gates-push-heavy-scheduled.md),
  [ADR 0025](0025-web-e2e-playwright-shared-vitest-config.md) (web e2e in mock mode).
- Measured 2026-07-27 with `@playwright/test` **1.60.0** on Linux 6.6 (WSL2),
  `net.ipv4.ip_local_port_range` = 32768 60999.
- Companion in web-native-skeleton: its ADR 1031, which had to converge that
  repo's gate onto `gate_commands()` before this step could land pinned.
