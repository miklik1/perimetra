# ADR 1042 — A new file is part of the tree state, and the gate tests now derive their own coverage

**Status:** Accepted (2026-07-28) — HQ-ruled default, Martin ratify queued
(do-first doctrine). W15 wave. Landed together with the web-native-skeleton twin,
**ADR 1035**. Extends the Stop-hook gate owned by
[ADR 1026](1026-the-stop-hook-gate-could-not-run-its-own-command.md),
[ADR 1029](1029-the-guards-were-guarding-nothing.md) and
[ADR 1038](1038-playwright-joins-the-gate-behind-an-opt-in-marker.md).

## Context

### The defect

`scripts/claude-gate.sh` computed its green-state hash as

```sh
state=$( { git rev-parse HEAD; git diff; git diff --cached; } | sha1sum | cut -d' ' -f1)
```

`git diff` and `git diff --cached` both report **tracked paths only**. So a turn
whose only change is a _new file_ produced the byte-identical hash the previous
green run had written, and skip 2 fired:

```
run 1 (green, writes marker)      exit=0   steps run: 3
add ONE new untracked .ts file
run 2                             exit=0   steps run: 0   <-- exit 0, nothing ran
```

Reproduced against the landed tree, 2026-07-28. Exit 0, no output, no
"skipped" — a pass indistinguishable from a real one.

Skip 1 was never the hole: `git status --porcelain` does report `?? path`, so a
new-file-only turn correctly gets past the markdown-only skip and then dies on
the hash. And "add a new module / test / route" is what an ordinary turn looks
like — in this repo `pnpm gen module` produces exactly that shape — so this was
not an exotic input. It shipped in both skeletons and in every project stamped
from either.

### The thing behind the defect

This is the **third** time this gate has been fixed for the same shape — a guard
that was not guarding itself (ADR 1029, ADR 1038, now this). Each previous fix
added one more hand-written case, and that pattern does not converge: a case gets
written for the defect somebody already found, and the branch nobody thought
about stays unpinned. The sibling skeleton measured the cost of exactly that:
deleting `pnpm audit:gate` from its gate left its suite **25/25 GREEN**.

## Decision

### 1. Untracked files are part of the state — name _and_ content

```sh
untracked=$(git ls-files --others --exclude-standard 2>/dev/null)
state=$( { git rev-parse HEAD
           git diff
           git diff --cached
           printf '%s\n' "$untracked"
           [ -n "$untracked" ] && printf '%s\n' "$untracked" | git hash-object --stdin-paths
         } 2>/dev/null | sha1sum | cut -d' ' -f1)
```

Three choices in there are load-bearing:

- **Content, not just the name list.** A name-only state passes the new-file case
  and fails the next one: the first save of a new file would gate, and every
  subsequent edit of it would skip — the same defect one step further in, and
  harder to see. Case 15(d) exists specifically to kill that cheap fix, and it
  does (verified below).
- **`git hash-object --stdin-paths`, not `xargs sha1sum`.** This repo's own
  `scripts/__tests__/claude-gate.test.sh` runs every case under `env -i` with a
  CURATED PATH built by `make_toolbin` — a fixed list of exactly the binaries the
  gate is known to need — and `xargs` is not on it. Reaching outside that set
  fails _silently_: stderr is discarded, `untracked` comes back empty, and the
  hash is stable again, i.e. straight back to the fail-open being closed. `git`
  is already the one hard dependency of every line above it. (The first draft of
  this fix used `xargs -0 sha1sum` and would have been green in CI and dead in
  the harness — the curated list is what caught it.)
- **The `[ -n … ]` guard.** `git hash-object --stdin-paths` on empty input is
  `fatal: could not open ''`, not a no-op.

`--exclude-standard` keeps .gitignore in force, so `node_modules` / `.turbo` /
`dist` are never walked. Measured on this repo: **3 ms** clean, **3 ms** with 50
untracked files.

### 2. The gate tests derive their own step coverage (case 16)

Rather than a fourth hand-written case, the suite now **parses `gate_commands()`
out of the gate under test** and asserts, for every step it finds:

- (i) the step is **invoked** — not dead code behind a condition nobody meets;
- (ii) when it REDs, the stop is **blocked** — the "present but toothless"
  mutation (`|| return 1` → `|| true`), which leaves every invocation assertion
  in case 12 green;
- (iii) when it REDs, everything **after** it is skipped — short-circuiting is
  the entire reason the order is cheapest-first.

The e2e step is armed (`CLAUDE_GATE_E2E=1`) for the whole loop, because an
unreachable step cannot be covered and contributing zero assertions silently is
exactly the vacuity this case exists to prevent. For the same reason the derived
list is asserted non-empty first: if the parse breaks — the function renamed,
reindented, rewritten — the loop runs zero times and would otherwise report
nothing while looking green.

**A step added to `gate_commands()` tomorrow is covered the moment it is added,
with no edit to the suite.** A step _deleted_ stops being asserted, which is
correct — and is why case 12 keeps its own explicitly named
`check:gitleaks-pin` / `test:scripts` assertions: deleting those still REDs.

## Consequences

Disarm-verified against the LANDED tree, driving mutants through
`CLAUDE_GATE_PATH` (the mechanism ADR 1026 added for exactly this):

| mutant                                      | result                                                 |
| ------------------------------------------- | ------------------------------------------------------ |
| the pre-fix state hash (tracked only)       | case 15 **(c) and (d) RED** — 105/107                  |
| the cheap fix: untracked NAME LIST only     | case 15 **(d) RED**, (c) passes — 106/107              |
| `pnpm test:scripts … \|\| true` (toothless) | case 16 **(ii),(iii) RED**, (i) still passes — 101/107 |

Suite: 87 → **107 assertions**, all green on the fixed gate.

- The gate now costs one extra `git ls-files` + one `git hash-object` per stop
  (3 ms measured). That is paid on every stop including the ones that then skip,
  which is the correct place to pay it: the skip decision is what was wrong.
- **A large untracked file is now hashed on every stop.** A gitignored path costs
  nothing, but an un-ignored build artifact would be re-read each time. That is
  the honest trade — a gate that cannot see a file cannot gate on it — and the
  remedy is .gitignore, not a narrower hash.
- **What is still not covered:** case 16 pins the steps _inside_
  `gate_commands()`. The two SKIP branches above it are covered only by cases
  15(a)–(d) and the markdown-only fixtures, i.e. by hand. A derived-coverage
  assertion over the skip branches would be the fourth iteration of this idea and
  is boarded, not taken.

## Sources

- The reproduction above, run against `142a768` on this box, 2026-07-28.
- Mutation runs recorded in the table above, same session.
- `git ls-files --others --exclude-standard | git hash-object --stdin-paths`
  behaviour verified directly, including the empty-input `fatal`.
