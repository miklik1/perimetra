#!/usr/bin/env bash
# Hermetic tests for scripts/claude-gate.sh — the Stop-hook gate's own INVOCATION path.
#
# Why this file exists at all: mercata (where this fix originated) verified the
# repair BY HAND, under a stripped environment, and shipped no test. That is
# defensible in a product repo. It is not defensible here — this skeleton is
# COPIED into new projects, and a manual recipe that lives only in a commit body
# does not survive the copy. The rules the gate depends on (node runtime dirs
# prepended LAST; a tooling fault is never reported as a test failure) are
# invisible to every check the script itself performs, so without these tests
# they are prose that decays silently.
#
# Run:  bash scripts/__tests__/claude-gate.test.sh
#
# Hermeticity: every case runs under `env -i` with a CURATED PATH containing only
# symlinks to the coreutils the gate needs. The real /usr/bin is deliberately NOT
# on that PATH — this box has a /usr/bin/node v12.22.9 which would leak into the
# "no node anywhere" cases and silently invalidate them.

set -uo pipefail

# CLAUDE_GATE_PATH exists so a mutant copy can be pointed at without touching the
# repo's own script — that is how this suite is verified to actually RED (see the
# mutation table in docs/adr/1026-*.md).
GATE="${CLAUDE_GATE_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/claude-gate.sh}"
[ -f "$GATE" ] || { echo "cannot find claude-gate.sh at $GATE" >&2; exit 1; }

pass_count=0
fail_count=0
CURRENT_CASE=""

ok()   { pass_count=$((pass_count + 1)); printf '    ok   %s\n' "$1"; }
notok() {
  fail_count=$((fail_count + 1))
  printf '    FAIL %s\n' "$1"
  [ -n "${2:-}" ] && printf '         %s\n' "$2"
  return 0
}

assert_eq() { # label expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else notok "$1" "expected [$2], got [$3]"; fi
}
assert_contains() { # label haystack needle
  case "$2" in *"$3"*) ok "$1" ;; *) notok "$1" "expected to contain [$3]" ;; esac
}
assert_not_contains() { # label haystack needle
  case "$2" in *"$3"*) notok "$1" "expected NOT to contain [$3]" ;; *) ok "$1" ;; esac
}

# ---------------------------------------------------------------------------
# Fixture construction
# ---------------------------------------------------------------------------

# A curated bin dir: only the tools the gate legitimately needs, so nothing else
# on this machine can influence a case.
make_toolbin() {
  local bin="$1"; mkdir -p "$bin"
  local t src
  # `tail` is easy to forget here and its absence is NOT silent-safe: the gate
  # pipes its failure output through `tail -60`, so omitting it empties the
  # reported diagnostics while the exit code still looks right.
  for t in git awk grep sed cut tr tail head sha1sum cat rm dirname mkdir sh bash env ls; do
    src=$(command -v "$t" 2>/dev/null) && ln -sf "$src" "$bin/$t"
  done
}

# A git repo with .nvmrc=24 and one DIRTY NON-MARKDOWN file. The dirty file is
# mandatory: without it the markdown-only skip at claude-gate.sh:19-20 exits 0
# before reaching anything under test, and every case would vacuously pass.
make_fixture() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  printf '24' > "$dir/.nvmrc"
  printf 'seed\n' > "$dir/seed.txt"
  git -C "$dir" add -A
  git -C "$dir" -c user.email=t@t -c user.name=t commit -qm seed
  printf 'dirty\n' > "$dir/dirty.ts"   # non-markdown, uncommitted
}

# Stub node printing a chosen version.
make_node() { # dir version
  mkdir -p "$1"
  printf '#!/bin/sh\necho %s\n' "$2" > "$1/node"
  chmod +x "$1/node"
}

# Stub pnpm. Records that it ran and which node it resolved, into $PNPM_LOG.
# exit_code lets a case choose the "gates pass" vs "gates fail" outcome.
make_pnpm() { # dir log exit_code
  mkdir -p "$1"
  cat > "$1/pnpm" <<EOF
#!/bin/sh
# corepack-shim-alike: it resolves node from PATH, exactly as the real one does.
{ echo "pnpm invoked: \$*"; echo "pnpm saw node: \$(node -v 2>&1)"; } >> "$2"
[ $3 -ne 0 ] && echo "some-package:test: FAILED assertion in foo.test.ts" >&2
exit $3
EOF
  chmod +x "$1/pnpm"
}

# Run the gate. Captures stdout, stderr and exit code separately.
run_gate() { # session_id fixture fake_home extra_path_dirs...
  local sid="$1" fixture="$2" fhome="$3"; shift 3
  local extra="" d
  for d in "$@"; do extra="$extra:$d"; done
  OUT_FILE=$(mktemp); ERR_FILE=$(mktemp)
  printf '{"session_id":"%s"}' "$sid" | env -i \
    HOME="$fhome" \
    PATH="${TOOLBIN}${extra}" \
    CLAUDE_PROJECT_DIR="$fixture" \
    bash "$GATE" >"$OUT_FILE" 2>"$ERR_FILE"
  STATUS=$?
  STDOUT=$(cat "$OUT_FILE"); STDERR=$(cat "$ERR_FILE")
  rm -f "$OUT_FILE" "$ERR_FILE"
}

# Concurrency. The gate's loop-guard files live in a SHARED /tmp keyed by session
# id, so the session ids this suite invents are a global namespace. Hard-coded
# ids (`t-c1`…`t-c9`) plus a wildcard `rm -f /tmp/claude-gate-*-t-*` at every
# begin() meant two simultaneous runs on one host deleted each other's guard
# files mid-case — a false RED in exactly cases 6/7/8, the ones that ASSERT on
# guard-file existence. That is not hypothetical here: CI's concurrency group is
# event-scoped, so a push run and the Monday schedule run are not collapsed, and
# on the self-hosted runner of ADR 1007 they share one /tmp. So: a per-run unique
# namespace, and cleanup confined to it.
RUN_ID="$$-$(date +%s)-${RANDOM:-0}"
sid() { printf 't-%s-%s' "$RUN_ID" "$1"; }              # unique session id per case
tooling_guard() { printf '/tmp/claude-gate-tooling-%s' "$(sid "$1")"; }
fail_guard()    { printf '/tmp/claude-gate-fail-%s' "$(sid "$1")"; }

clean_guards() {
  rm -f "/tmp/claude-gate-tooling-t-${RUN_ID}-"* "/tmp/claude-gate-fail-t-${RUN_ID}-"* 2>/dev/null
  return 0
}

begin() { CURRENT_CASE="$1"; printf '\n  %s\n' "$1"; clean_guards; }

ROOT=$(mktemp -d); trap 'rm -rf "$ROOT"; clean_guards' EXIT
TOOLBIN="$ROOT/toolbin"; make_toolbin "$TOOLBIN"

printf 'claude-gate.sh — invocation-path tests\n'

# ---------------------------------------------------------------------------
# 1. Resolution actually happens (fault (a): the command was never resolved)
# ---------------------------------------------------------------------------
begin "resolves the pinned node from a version-manager dir"
F="$ROOT/c1"; H="$ROOT/h1"; L="$ROOT/c1.log"
make_fixture "$F"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0
run_gate "$(sid c1)" "$F" "$H"
assert_eq "exit 0 (gate ran and passed)" 0 "$STATUS"
assert_contains "pnpm was invoked" "$(cat "$L" 2>/dev/null)" "pnpm invoked: turbo run check-types lint test"
assert_contains "pnpm ran under the pinned node" "$(cat "$L" 2>/dev/null)" "pnpm saw node: v24.18.0"

# ---------------------------------------------------------------------------
# 2. A tooling fault is NOT dressed up as a gate failure (fault (b))
#    The NEGATIVE assertion is the load-bearing half of this case.
# ---------------------------------------------------------------------------
begin "a tooling fault is not reported as a gate failure"
F="$ROOT/c2"; H="$ROOT/h2"
make_fixture "$F"; mkdir -p "$H"
run_gate "$(sid c2)" "$F" "$H"
assert_eq "exit 2 (stop blocked)" 2 "$STATUS"
assert_contains "names itself a tooling fault" "$STDERR" "TOOLING fault, not a test failure"
assert_contains "says the gate did not run" "$STDERR" "The gate did NOT RUN"
assert_not_contains "does NOT blame the code" "$STDERR" "GATE FAILED"

# ---------------------------------------------------------------------------
# 3. PATH ORDER, pinned for real: a node inside a LOW-PRIORITY CANDIDATE DIR
#    must lose to the .nvmrc-pinned one.
#
#    The earlier form of this case claimed to "RED if the loop order is
#    reversed" and did not: it put the stale node on the plain inherited PATH,
#    which EVERY candidate dir outranks by construction (they are all prepended),
#    so the loop's internal order was never observed and the reversed mutant
#    stayed 38/38 green. A test that cannot see the property it names is worse
#    than no test — it is a green light on the exact refactor it advertises
#    catching.
#
#    The layout that actually discriminates is the common corepack + distro-node
#    one: `$HOME/.local/bin` holds BOTH the corepack `pnpm` shim and a node.
#    `.local/bin` is a candidate dir listed EARLY, i.e. deliberately LOW
#    priority; the fnm dir is listed LAST and must win. Reverse the loop and
#    `.local/bin` is prepended last, the stale v12 wins, and the corepack shim
#    executes under it — the silent SyntaxError-inside-the-shim mode the
#    ordering rule exists to prevent. Under the reversal the post-condition now
#    fires and this case REDs (verified by mutation, see ADR 1029).
# ---------------------------------------------------------------------------
begin "PATH order — a node in a low-priority candidate dir loses to the pinned one"
F="$ROOT/c3"; H="$ROOT/h3"; L="$ROOT/c3.log"
make_fixture "$F"
make_node "$H/.local/bin" v12.22.9                        # distro-ish node, SAME dir as the shim
make_pnpm "$H/.local/bin" "$L" 0                          # corepack shim lives here too
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
run_gate "$(sid c3)" "$F" "$H"
assert_eq "exit 0" 0 "$STATUS"
assert_contains "pinned node won over the candidate-dir one" "$(cat "$L" 2>/dev/null)" "pnpm saw node: v24.18.0"
assert_not_contains "stale node did not run the gate" "$(cat "$L" 2>/dev/null)" "pnpm saw node: v12.22.9"
assert_not_contains "no false tooling fault" "$STDERR" "TOOLING fault"

# ---------------------------------------------------------------------------
# 4. THE DECISIVE CASE. The post-condition catches a resolution that silently
#    did nothing. REDs if the assertion is deleted as "duplicated logic" — which
#    is exactly the refactor the in-file comment warns against.
# ---------------------------------------------------------------------------
begin "the post-condition catches a resolution that silently did nothing"
F="$ROOT/c4"; H="$ROOT/h4"; L="$ROOT/c4.log"
make_fixture "$F"
make_node "$ROOT/oldnode4" v12.22.9
make_pnpm "$H/.local/bin" "$L" 0          # pnpm findable, but NO node >= 24 anywhere
run_gate "$(sid c4)" "$F" "$H" "$ROOT/oldnode4"
assert_eq "exit 2 (stop blocked)" 2 "$STATUS"
assert_contains "names the version it FOUND" "$STDERR" "resolved node is v12.22.9"
assert_contains "names the version it WANTED" "$STDERR" ".nvmrc wants v24.x"
assert_contains "classified as tooling, not code" "$STDERR" "TOOLING fault, not a test failure"
assert_not_contains "did not blame the code" "$STDERR" "GATE FAILED"
assert_eq "pnpm was never invoked under a bad toolchain" "" "$(cat "$L" 2>/dev/null)"

# ---------------------------------------------------------------------------
# 5. Resolution is keyed on the NODE MAJOR, not on the presence of pnpm.
#    REDs if the trigger is rewritten to `if ! command -v pnpm; then` — under
#    that mutation pnpm is already findable, the block is skipped entirely, and
#    case 4's assertion fires on v12.
# ---------------------------------------------------------------------------
begin "resolution is keyed on the node major, not on the presence of pnpm"
F="$ROOT/c5"; H="$ROOT/h5"; L="$ROOT/c5.log"
make_fixture "$F"
make_node "$ROOT/oldnode5" v12.22.9
make_pnpm "$H/.local/bin" "$L" 0                          # pnpm ALREADY findable
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
run_gate "$(sid c5)" "$F" "$H" "$ROOT/oldnode5" "$H/.local/bin"
assert_eq "exit 0 — resolution still ran despite pnpm being present" 0 "$STATUS"
assert_contains "resolved the pinned node anyway" "$(cat "$L" 2>/dev/null)" "pnpm saw node: v24.18.0"

# ---------------------------------------------------------------------------
# 6. The tooling fault honours the same-failure-twice release.
#    REDs if the message is ported without the hash/guard logic, which would let
#    an unfixable fault deadlock a session to the 8-block cap.
# ---------------------------------------------------------------------------
begin "the same tooling fault twice releases the stop"
F="$ROOT/c6"; H="$ROOT/h6"
make_fixture "$F"; mkdir -p "$H"
run_gate "$(sid c6)" "$F" "$H"
assert_eq "first occurrence blocks (exit 2)" 2 "$STATUS"
[ -f $(tooling_guard c6) ] && ok "guard file written" || notok "guard file written"
run_gate "$(sid c6)" "$F" "$H"
assert_eq "second identical fault releases (exit 0)" 0 "$STATUS"
assert_contains "surfaced via systemMessage" "$STDOUT" '"systemMessage"'
assert_contains "says the gate did not run" "$STDOUT" "same tooling fault twice"
[ -f $(tooling_guard c6) ] && notok "guard file cleared after release" || ok "guard file cleared after release"

# ---------------------------------------------------------------------------
# 7. The tooling guard is INDEPENDENT of the test-failure guard.
#    REDs if the two paths are "simplified" onto one guard file, which would let
#    a tooling fault and a test failure cancel each other's release counter.
# ---------------------------------------------------------------------------
begin "the tooling guard is independent of the test-failure guard"
F="$ROOT/c7"; H="$ROOT/h7"
make_fixture "$F"; mkdir -p "$H"
run_gate "$(sid c7)" "$F" "$H"
[ -f $(tooling_guard c7) ] && ok "wrote the TOOLING guard" || notok "wrote the TOOLING guard"
[ -f $(fail_guard c7) ] && notok "must not write the test-failure guard" || ok "did not write the test-failure guard"

# ---------------------------------------------------------------------------
# 8. The third outcome: a real ASSERTION FAILURE still reports as one.
#    Guards against a port that makes everything look like a tooling fault.
# ---------------------------------------------------------------------------
begin "a genuine gate failure is still reported as a gate failure"
F="$ROOT/c8"; H="$ROOT/h8"; L="$ROOT/c8.log"
make_fixture "$F"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 1          # toolchain fine, gates RED
run_gate "$(sid c8)" "$F" "$H"
assert_eq "exit 2 (stop blocked)" 2 "$STATUS"
assert_contains "blames the code, correctly" "$STDERR" "GATE FAILED"
assert_contains "shows the failure output" "$STDERR" "FAILED assertion in foo.test.ts"
assert_not_contains "not misfiled as a tooling fault" "$STDERR" "TOOLING fault"
[ -f $(fail_guard c8) ] && ok "wrote the TEST-FAILURE guard" || notok "wrote the TEST-FAILURE guard"
[ -f $(tooling_guard c8) ] && notok "must not write the tooling guard" || ok "did not write the tooling guard"

# ---------------------------------------------------------------------------
# 9. A correct node already on PATH passes cleanly with zero candidate dirs.
#    Covers boxes using a layout the loop does not enumerate (nix, homebrew, a
#    container image with node in /usr/local/bin): the trigger may fire and match
#    nothing, and that must NOT produce a false tooling fault.
# ---------------------------------------------------------------------------
begin "a correct node already on PATH passes with zero candidate dirs matching"
F="$ROOT/c9"; H="$ROOT/h9"; L="$ROOT/c9.log"
make_fixture "$F"; mkdir -p "$H"
make_node "$ROOT/usrlocal9" v24.16.0      # right major, in a dir the loop never lists
make_pnpm "$ROOT/usrlocal9" "$L" 0
run_gate "$(sid c9)" "$F" "$H" "$ROOT/usrlocal9"
assert_eq "exit 0 — no false tooling fault" 0 "$STATUS"
assert_not_contains "no tooling fault raised" "$STDERR" "TOOLING fault"
assert_contains "the pre-existing node ran the gate" "$(cat "$L" 2>/dev/null)" "pnpm saw node: v24.16.0"

# ---------------------------------------------------------------------------
# 10. A MISSING .nvmrc is a TOOLING FAULT, not a skip.
#     The post-condition used to be guarded by `[ -n "$want_major" ]`, which
#     fails OPEN: with no .nvmrc there is nothing to compare against, the check
#     was skipped entirely, and the gate ran pnpm under whatever node PATH
#     offered and reported GREEN. A project generated from this skeleton that
#     drops or renames .nvmrc would silently lose the pin — the precise mode the
#     post-condition exists to eliminate. REDs if the `-n` guard comes back.
# ---------------------------------------------------------------------------
begin "a missing .nvmrc is a tooling fault, not a silent skip"
F="$ROOT/c10"; H="$ROOT/h10"; L="$ROOT/c10.log"
make_fixture "$F"; rm -f "$F/.nvmrc"      # the pin is gone
make_node "$H/.local/bin" v12.22.9        # …and only a stale node is available
make_pnpm "$H/.local/bin" "$L" 0
run_gate "$(sid c10)" "$F" "$H"
assert_eq "exit 2 (stop blocked)" 2 "$STATUS"
assert_contains "names the missing pin" "$STDERR" ".nvmrc is missing or unreadable"
assert_contains "classified as tooling, not code" "$STDERR" "TOOLING fault, not a test failure"
assert_not_contains "did not blame the code" "$STDERR" "GATE FAILED"
assert_eq "pnpm was never invoked without a pin" "" "$(cat "$L" 2>/dev/null)"

# ---------------------------------------------------------------------------
# 11. Static: the anti-deletion rationale must survive future cleanups.
#     The reference's defence against re-introducing the ordering and
#     pnpm-keying hazards IS the comment; a silent comment-strip is the
#     realistic way this regresses.
# ---------------------------------------------------------------------------
begin "the anti-deletion rationale is still in the file"
grep -q 'must not be deleted as duplicated' "$GATE" \
  && ok "post-condition anti-deletion notice present" \
  || notok "post-condition anti-deletion notice present"
grep -q 'node runtime dirs last (highest)' "$GATE" \
  && ok "PATH-ordering rule documented" \
  || notok "PATH-ordering rule documented"
grep -q 'The requirement was never "a pnpm exists"' "$GATE" \
  && ok "node-keying rationale documented" \
  || notok "node-keying rationale documented"

# ---------------------------------------------------------------------------
# 12. The gate RUNS THE GUARDS THAT GUARD IT — and a failing guard blocks.
#
#     ADR 1029 decision 6 added `pnpm check:gitleaks-pin` and `pnpm test:scripts`
#     to the gate precisely because `turbo run` reaches only workspace tasks and
#     could never reach them. Nothing pinned that. Measured: deleting both lines
#     from claude-gate.sh left this suite 44/44 GREEN — the same "a control whose
#     weakening reddens nothing" shape the ADR was written to eliminate, live in
#     the ADR's own decision. Three properties are pinned here, because the
#     obvious single assertion (the commands appear in the log) would survive a
#     reordering or a swallowed failure:
#       (a) both guards are invoked at all;
#       (b) they run BEFORE the turbo tasks — cheapest first, so a broken guard
#           reports without paying for check-types/lint/test;
#       (c) a guard that REDs blocks the stop and short-circuits, so turbo never
#           runs. Without (c) the two lines could be present and their exit codes
#           ignored, which reads identically in a log.
# ---------------------------------------------------------------------------

# pnpm stub that fails for ONE subcommand only, so a single guard can be reddened
# without reddening the others. $3 is a `case` pattern matched against $1.
make_pnpm_selective() { # dir log fail_on_pattern
  mkdir -p "$1"
  cat > "$1/pnpm" <<EOF
#!/bin/sh
{ echo "pnpm invoked: \$*"; echo "pnpm saw node: \$(node -v 2>&1)"; } >> "$2"
case "\$1" in
  $3) echo "pnpm: \$1 reported a failure" >&2; exit 1 ;;
esac
exit 0
EOF
  chmod +x "$1/pnpm"
}

assert_order() { # label log_file earlier later
  local a b
  a=$(grep -n -F "pnpm invoked: $3" "$2" 2>/dev/null | head -1 | cut -d: -f1)
  b=$(grep -n -F "pnpm invoked: $4" "$2" 2>/dev/null | head -1 | cut -d: -f1)
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then ok "$1"
  else notok "$1" "[$3] at ${a:-<never invoked>} must precede [$4] at ${b:-<never invoked>}"; fi
}

begin "the gate runs its own guards, cheapest first"
F="$ROOT/c12"; H="$ROOT/h12"; L="$ROOT/c12.log"
make_fixture "$F"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0
run_gate "$(sid c12)" "$F" "$H"
assert_eq "exit 0" 0 "$STATUS"
assert_contains "ran the supply-chain pin guard" "$(cat "$L" 2>/dev/null)" "pnpm invoked: check:gitleaks-pin"
assert_contains "ran the repo script tests" "$(cat "$L" 2>/dev/null)" "pnpm invoked: test:scripts"
assert_order "pin guard runs before the turbo tasks" "$L" "check:gitleaks-pin" "turbo run"
assert_order "script tests run before the turbo tasks" "$L" "test:scripts" "turbo run"

begin "a red supply-chain pin guard blocks the stop and skips the turbo tasks"
F="$ROOT/c12b"; H="$ROOT/h12b"; L="$ROOT/c12b.log"
make_fixture "$F"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm_selective "$H/.local/bin" "$L" 'check:gitleaks-pin'
run_gate "$(sid c12b)" "$F" "$H"
assert_eq "exit 2 (stop blocked)" 2 "$STATUS"
assert_contains "blames the code path, not the toolchain" "$STDERR" "GATE FAILED"
assert_not_contains "not misfiled as a tooling fault" "$STDERR" "TOOLING fault"
assert_not_contains "short-circuited before the expensive tasks" "$(cat "$L" 2>/dev/null)" "pnpm invoked: turbo run"

begin "red repo script tests block the stop and skip the turbo tasks"
F="$ROOT/c12c"; H="$ROOT/h12c"; L="$ROOT/c12c.log"
make_fixture "$F"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm_selective "$H/.local/bin" "$L" 'test:scripts'
run_gate "$(sid c12c)" "$F" "$H"
assert_eq "exit 2 (stop blocked)" 2 "$STATUS"
assert_contains "blames the code path, not the toolchain" "$STDERR" "GATE FAILED"
assert_not_contains "short-circuited before the expensive tasks" "$(cat "$L" 2>/dev/null)" "pnpm invoked: turbo run"

printf '\n  %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
