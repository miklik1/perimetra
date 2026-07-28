#!/usr/bin/env bash
# Claude Code Stop-hook gate: Claude may not stop while the quality gates are red.
# Exit 0 = allow stop. Exit 2 = block stop; stderr is fed back to Claude as
# instructions to keep working. Registered in .claude/settings.json (Stop hook).
#
# Defense in depth (so this never hammers or wastes tokens):
#   1. No-change / markdown-only skip — Q&A sessions cost one `git status`.
#   2. Green-state hash — the gate never re-runs on an already-passed tree.
#   3. Same-failure-twice release — a failure Claude can't fix releases the stop
#      (surfaced via systemMessage) instead of looping to the 8-block cap.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0

input=$(cat)
session=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# Skip 1: nothing changed (Q&A sessions), or only markdown changed.
changed=$(git status --porcelain 2>/dev/null | awk '{print $NF}')
[ -z "$changed" ] && exit 0
printf '%s\n' "$changed" | grep -qvE '\.(md|mdx)$' || exit 0

# Skip 2: this exact tree state already passed once.
#
# UNTRACKED FILES ARE PART OF THE STATE (ADR 1042), and leaving them out was a
# FAIL-OPEN: `git diff` and `git diff --cached` both see TRACKED paths only, so a
# change that ADDS A NEW FILE and touches nothing already tracked produced the
# byte-identical hash the previous green run wrote — and the gate exited 0 having
# executed ZERO checks. That is the worst shape a gate has, because it is also
# the silent one: no output, no "skipped", just a pass. And it is not an exotic
# input — "add a new module / test / route" is what a normal turn looks like, and
# every project stamped from this skeleton inherited it.
#
# Skip 1 above was never the hole: `git status --porcelain` DOES report `?? path`,
# so a new-file-only turn correctly gets past it and then dies on the hash.
#
# The fix hashes NAME AND CONTENT, not just the name list. A name-only state
# would make the FIRST save of a new file gate and every subsequent edit of it
# skip — the same defect one step further in, and harder to see. `git hash-object
# --stdin-paths` is what supplies the content half.
#
# It is `git`, deliberately, and not `xargs sha1sum`. A Stop hook runs under a
# stripped environment, and this repo's own `scripts/__tests__/claude-gate.test.sh`
# goes further: `make_toolbin` builds a CURATED PATH containing only the binaries
# the gate is known to need, and `xargs` is not on it. Reaching for a binary
# outside that set fails SILENTLY — stderr is discarded and an empty `untracked`
# hashes to a stable value, i.e. straight back to the fail-open this block exists
# to close. `git` is already the one hard dependency of every line above.
#
# `--exclude-standard` keeps .gitignore in force, so node_modules / .turbo / dist
# are never walked. Measured on this repo: 3 ms clean, 3 ms with 50 untracked
# files. The `[ -n … ]` guard is required — `git hash-object --stdin-paths` on
# empty input is `fatal: could not open ''`, not a no-op.
untracked=$(git ls-files --others --exclude-standard 2>/dev/null)
state=$( { git rev-parse HEAD
           git diff
           git diff --cached
           printf '%s\n' "$untracked"
           [ -n "$untracked" ] && printf '%s\n' "$untracked" | git hash-object --stdin-paths
         } 2>/dev/null | sha1sum | cut -d' ' -f1)
green=.git/claude-gate-green
[ -f "$green" ] && [ "$(cat "$green")" = "$state" ] && exit 0

# Resolve the toolchain. A hook does not inherit an interactive shell's profile,
# so a version-managed node (fnm/nvm/asdf/volta) and corepack's `pnpm` shim are
# both typically absent from PATH here even though they work in a terminal. That
# is not a red tree, and it MUST NOT be reported as one: a gate that cannot run
# its own command is not a gate, and a failure message that blames the code for a
# missing binary sends the agent hunting a bug that does not exist.
# Gate this on NODE, not on pnpm. Keying it on `command -v pnpm` looks right and
# is subtly wrong: once corepack's shim has been installed into ~/.local/bin,
# `pnpm` IS findable, so the whole block gets skipped and node is never resolved
# — leaving the shim to run under whatever node PATH happens to offer, typically
# a distro one far older than .nvmrc. The requirement was never "a pnpm exists",
# it is "the toolchain .nvmrc pins is the one that runs".
if ! command -v node >/dev/null 2>&1 ||
   [ "$(node -v 2>/dev/null | tr -d 'v' | cut -d. -f1)" != "$(tr -d 'v \t\r\n' < .nvmrc 2>/dev/null | cut -d. -f1)" ] ||
   ! command -v pnpm >/dev/null 2>&1; then
  want=$(cat .nvmrc 2>/dev/null | tr -d 'v \t\r\n')
  # Order matters, and the obvious loop gets it BACKWARDS: prepending each dir in
  # turn leaves the FIRST one listed at the LOWEST priority. The node runtime dir
  # must win outright — a distro `/usr/bin/node` is typically far older than
  # .nvmrc's version, and corepack's `pnpm` shim is a plain script that resolves
  # `node` from PATH, so a stale node silently becomes a SyntaxError inside the
  # shim rather than an honest "wrong version" error. So: package-manager shim
  # dirs first (lowest priority), node runtime dirs last (highest).
  for dir in \
    "$HOME/.local/share/pnpm" \
    "$HOME/.local/bin" \
    "$HOME/.volta/bin" \
    "$HOME/.asdf/installs/nodejs/${want}"*/bin \
    "$HOME/.nvm/versions/node/v${want}"*/bin \
    "$HOME/.local/share/fnm/node-versions/v${want}"*/installation/bin
  do
    [ -d "$dir" ] && PATH="$dir:$PATH"
  done
  export PATH
  # corepack ships with node and provides the `pnpm` that `packageManager` pins.
  if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    corepack enable --install-directory "$HOME/.local/bin" >/dev/null 2>&1 &&
      PATH="$HOME/.local/bin:$PATH" && export PATH
  fi
fi
# A tooling fault must honour the SAME same-failure-twice release the test path
# gets (defense #3 in the header). Without it a fault Claude genuinely cannot fix
# from inside the session — no node installed at all, a read-only HOME — blocks
# every stop until the 8-block cap, which is the runaway this script was written
# to avoid. Reported once, then released.
tooling_fault() {
  { echo "$@"
    echo "The gate did NOT RUN. This is a TOOLING fault, not a test failure — do"
    echo "not go looking for a code bug. Fix the toolchain, then re-run:"
    echo "  pnpm check:gitleaks-pin && pnpm test:scripts &&"
    echo "  pnpm turbo run check-types lint test"
  } >&2
  faulthash=$(printf '%s' "$*" | sha1sum | cut -d' ' -f1)
  faultguard="/tmp/claude-gate-tooling-${session:-nosession}"
  if [ -f "$faultguard" ] && [ "$(cat "$faultguard")" = "$faulthash" ]; then
    rm -f "$faultguard"
    printf '{"systemMessage":"claude-gate: same tooling fault twice — releasing the stop; the gate did NOT run."}\n'
    exit 0
  fi
  printf '%s' "$faulthash" > "$faultguard"
  exit 2
}

if ! command -v pnpm >/dev/null 2>&1; then
  tooling_fault "claude-gate: pnpm is not on PATH (see .nvmrc for the node version)."
fi

# Self-check: the POST-CONDITION of the resolution block above. It repeats that
# block's version comparison on purpose and must not be deleted as duplicated
# logic — the test above decides whether to ATTEMPT resolution, this one asserts
# that the attempt actually SUCCEEDED. Without it the resolution can quietly do
# nothing (no candidate dir matched, a wrong dir won) and the gate proceeds on
# whatever node PATH happened to offer.
#
# It is also the test that pins the resolution ORDER, which otherwise has none.
# The priority rule (node runtime dirs LAST, so they win)
# is easy to reverse while refactoring, and reversing it does not fail loudly —
# corepack's `pnpm` shim is a plain script that resolves `node` from PATH, so a
# stale distro node surfaces as a SyntaxError on modern syntax INSIDE the shim,
# which reads like a broken repo rather than a broken PATH. Asserting the
# resolved node's major against .nvmrc converts that silent mode into a legible
# tooling fault that names the version it actually found.
want_major=$(tr -d 'v \t\r\n' < .nvmrc 2>/dev/null | cut -d. -f1)
got_version=$(command -v node >/dev/null 2>&1 && node -v 2>/dev/null)
got_major=$(printf '%s' "$got_version" | tr -d 'v' | cut -d. -f1)
# A missing or unreadable .nvmrc is a TOOLING FAULT, never a skip. The earlier
# form guarded this comparison with `[ -n "$want_major" ]`, which FAILED OPEN:
# with no .nvmrc there is no pin, so the gate ran pnpm under whatever node PATH
# offered — typically a distro v12 — and reported GREEN. That is precisely the
# silent-wrong-toolchain mode this post-condition exists to eliminate, and a
# project generated from this skeleton that renames or drops .nvmrc would lose
# the pin without a single line of output saying so. Failing here is safe: the
# tooling_fault path already has the same-failure-twice release, so a repo that
# genuinely has no .nvmrc reports once and is then let through.
if [ -z "$want_major" ]; then
  tooling_fault "claude-gate: .nvmrc is missing or unreadable, so there is no node version to pin against. The gate refuses to run pnpm under an unverified toolchain (a green gate from the wrong node major is worse than no gate). Restore .nvmrc at the repo root."
fi
if [ "$got_major" != "$want_major" ]; then
  tooling_fault "claude-gate: resolved node is ${got_version:-<none>}, but .nvmrc wants v${want_major}.x. The resolution above put an older node ahead of the .nvmrc one (node runtime dirs must be prepended LAST, so they end up highest priority)."
fi

# The gate runs the guards that protect the gate ITSELF, not just the workspace
# vitest tasks. `turbo run check-types lint test` reaches only tasks declared
# inside workspaces, so it can never reach `test:scripts` (the suite whose whole
# purpose is protecting THIS file) nor `check:gitleaks-pin` (the supply-chain
# pin guard, which lives in a workflow file no vitest suite can see). Without
# these two lines an agent could break claude-gate.sh, stop, and get a GREEN
# Stop hook — the break would only surface a full feedback cycle later at
# pre-push. A gate that does not run its own guards is the same "satisfiable
# without running" defect the guards were written to close.
#
# Cost, MEASURED on this box (3 runs): check:gitleaks-pin 0.02s (static,
# offline, no network by design), test:scripts 1.16–1.20s (hermetic bash, no
# network, no install) — ~1.2s of added wall clock, plus pnpm's own spawn
# overhead. Against a turbo-cached `check-types lint test` measured in seconds
# and an uncached one in tens of seconds, that is noise, and it is paid only on
# the runs that reach here at all (the no-change, markdown-only and green-hash
# skips above all return before this point). Accepted deliberately. Cheapest
# first, so a broken guard reports before the expensive tasks run.
#
# The e2e step is the same order rule taken one step further — it is the most
# expensive thing this repo can run (a browser plus a `next dev` boot), so it
# goes LAST, and it is OPT-IN and OFF by default. The gate fires on every stop:
# a Playwright run per stop would tax every derived project for a suite that
# only earns its cost on waves that actually touch the web surface. Without it,
# though, no gate and no pre-push hook invokes Playwright at all, so a reskin
# ships gate-green and CI-red — the failure this step exists to move earlier.
#
# The MARKER FILE is the primary opt-in, not the env var. `.git/` is never
# committed and the gate already writes `.git/claude-gate-green` there, so both
# the path and the .gitignore posture are already proven; a seat arms the wave
# with `touch .git/claude-gate-e2e` and disarms it by deleting the file. The env
# var stays as a one-off override for a manual run and for the selftest.
#
# THE E2E STEP MUST OWN THE SERVER IT DRIVES. `playwright.config.ts` sets
# `reuseExistingServer` true for a local run, so a run that finds the wait-URL
# already answering NEVER BOOTS ITS OWN SERVER and never says so. Measured with
# Playwright 1.60 against a foreign HTTP server on the wait-URL: reuse-true drove
# the impostor and reported the suite's own verdict (exit 0, "1 failed" only
# because the probe spec asserted on the body); reuse-false refused to start —
# `Error: http://localhost:PORT is already used ...`, exit 1, zero tests run.
# So the gate declares ownership and gets a LOUD collision instead of a quiet
# false green. Two halves, and BOTH are needed:
#
#   1. WEB_E2E_OWN_SERVER=1 — the fail-closed knob. It is NOT `CI=1`: `CI` also
#      flips forbidOnly, retries (0→1), workers (parallel→1) and the reporter
#      (list → github + html), and leaks into the `next dev` child, which is four
#      unrelated behaviour changes plus a written `playwright-report/` per stop
#      to buy one. Measured: the targeted knob produces the identical
#      "already used" refusal with none of that. See ADR 1038.
#
#   2. A PER-CHECKOUT PORT. A single hardcoded constant is the same hazard wearing
#      a different number: every skeleton and every project stamped from it
#      inherits the SAME constant, so on a multi-seat box the gate that starts
#      second finds the port bound — and before (1) it would then have driven the
#      sibling repo's app, whose routes, UI and Czech 404 strings are identical.
#      The port is therefore derived from the repo root's PHYSICAL path: stable
#      for a checkout (same port every run), different for a sibling checkout or
#      a worktree. The path is the right key precisely because worktrees — the
#      fleet's normal multi-seat topology — share a remote and a HEAD lineage but
#      never a path. 61000-65535 sits inside IANA's dynamic/private range and
#      ABOVE Linux's default ephemeral ALLOCATION range (32768-60999 on this box,
#      `net.ipv4.ip_local_port_range`), so the kernel never hands one of these
#      out to an outbound socket. CLAUDE_GATE_WEB_PORT still overrides.
gate_web_port() {
  local h
  h=$(pwd -P | sha1sum | cut -c1-8)
  printf '%d' $(( 61000 + (16#$h % 4536) ))
}
gate_commands() {
  pnpm check:gitleaks-pin 2>&1 || return 1
  pnpm test:scripts 2>&1 || return 1
  pnpm turbo run check-types lint test --output-logs=errors-only 2>&1 || return 1
  if [ -n "${CLAUDE_GATE_E2E:-}" ] || [ -f .git/claude-gate-e2e ]; then
    WEB_PORT="${CLAUDE_GATE_WEB_PORT:-$(gate_web_port)}" WEB_E2E_OWN_SERVER=1 \
      pnpm test:e2e 2>&1 || return 1
  fi
}
out=$(gate_commands)
if [ $? -eq 0 ]; then
  printf '%s' "$state" > "$green"
  exit 0
fi

# Loop guard: identical failure twice in a row this session -> release the stop.
failhash=$(printf '%s' "$out" | tail -60 | sha1sum | cut -d' ' -f1)
guard="/tmp/claude-gate-fail-${session:-nosession}"
if [ -f "$guard" ] && [ "$(cat "$guard")" = "$failhash" ]; then
  rm -f "$guard"
  printf '{"systemMessage":"claude-gate: same failure twice — letting the stop through, fix manually."}\n'
  exit 0
fi
printf '%s' "$failhash" > "$guard"

{ echo "GATE FAILED — gates must be green before you stop:"
  printf '%s\n' "$out" | tail -60
  echo "Fix these failures, then finish your turn again."
} >&2
exit 2
