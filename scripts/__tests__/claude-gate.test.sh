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
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
GATE="${CLAUDE_GATE_PATH:-$REPO_ROOT/scripts/claude-gate.sh}"
[ -f "$GATE" ] || { echo "cannot find claude-gate.sh at $GATE" >&2; exit 1; }
# The other half of the fail-closed contract lives in the Playwright config the
# gate's step loads (case 14c). Same override mechanism as CLAUDE_GATE_PATH, and
# for the same reason: a mutant can be pointed at without editing a tracked file.
PW_CONFIG="${CLAUDE_GATE_PW_CONFIG:-$REPO_ROOT/apps/web/playwright.config.ts}"

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
assert_ne() { # label not_expected actual
  if [ "$2" != "$3" ]; then ok "$1"; else notok "$1" "expected anything BUT [$2]"; fi
}
assert_port_in_range() { # label port low high
  case "$2" in
    ''|*[!0-9]*) notok "$1" "not a port number: [${2:-<empty>}]"; return 0 ;;
  esac
  if [ "$2" -ge "$3" ] && [ "$2" -le "$4" ]; then ok "$1"
  else notok "$1" "port $2 is outside $3-$4"; fi
}

# The WEB_PORT the e2e STEP saw — not the last one in the log. Every gate step
# logs a WEB_PORT line (`<unset>` for all but e2e), so a bare grep would answer
# about whichever step ran last. Anchored to the `test:e2e` invocation instead.
gate_e2e_port() { # log_file
  awk '/pnpm invoked: test:e2e/{seen=1; next}
       seen && /pnpm saw WEB_PORT:/{print $NF; exit}' "$1" 2>/dev/null
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
# WEB_PORT and WEB_E2E_OWN_SERVER are logged because the e2e step's port and its
# server-ownership declaration are load-bearing, not cosmetic (cases 13a–13d,
# 14a–14c): without a per-checkout port two seats collide, and without the
# ownership flag `reuseExistingServer` makes the colliding run silently drive the
# OTHER seat's app. Every other invocation logs `<unset>` for both, which is
# exactly what must never appear on the `test:e2e` line.
make_pnpm() { # dir log exit_code
  mkdir -p "$1"
  cat > "$1/pnpm" <<EOF
#!/bin/sh
# corepack-shim-alike: it resolves node from PATH, exactly as the real one does.
{ echo "pnpm invoked: \$*"
  echo "pnpm saw node: \$(node -v 2>&1)"
  echo "pnpm saw WEB_PORT: \${WEB_PORT:-<unset>}"
  echo "pnpm saw WEB_E2E_OWN_SERVER: \${WEB_E2E_OWN_SERVER:-<unset>}"; } >> "$2"
[ $3 -ne 0 ] && echo "some-package:test: FAILED assertion in foo.test.ts" >&2
exit $3
EOF
  chmod +x "$1/pnpm"
}

# Run the gate. Captures stdout, stderr and exit code separately.
#
# GATE_ENV injects extra `K=V` pairs into the `env -i` line — the ONLY way to
# exercise an env-var-driven branch of the gate under a stripped environment.
# It is reset by begin() so a case can never inherit the previous one's env.
run_gate() { # session_id fixture fake_home extra_path_dirs...
  local sid="$1" fixture="$2" fhome="$3"; shift 3
  local extra="" d
  for d in "$@"; do extra="$extra:$d"; done
  OUT_FILE=$(mktemp); ERR_FILE=$(mktemp)
  # ${GATE_ENV:-} is deliberately UNQUOTED so `K=V K2=V2` splits into separate
  # env assignments; empty expands to nothing rather than to an empty argument.
  printf '{"session_id":"%s"}' "$sid" | env -i \
    HOME="$fhome" \
    PATH="${TOOLBIN}${extra}" \
    CLAUDE_PROJECT_DIR="$fixture" \
    ${GATE_ENV:-} \
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

GATE_ENV=""
begin() { CURRENT_CASE="$1"; printf '\n  %s\n' "$1"; clean_guards; GATE_ENV=""; }

# The listener kill is part of the trap, not just of the happy path: case 14c
# binds a real socket, and a suite that dies mid-case must not leave a port held
# on a box where other seats are choosing ports.
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"; clean_guards; kill "${LISTENER_PID:-}" 2>/dev/null' EXIT
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
{ echo "pnpm invoked: \$*"
  echo "pnpm saw node: \$(node -v 2>&1)"
  echo "pnpm saw WEB_PORT: \${WEB_PORT:-<unset>}"
  echo "pnpm saw WEB_E2E_OWN_SERVER: \${WEB_E2E_OWN_SERVER:-<unset>}"; } >> "$2"
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

# ---------------------------------------------------------------------------
# 13. THE OPT-IN PLAYWRIGHT STEP (ADR 1038).
#
#     Before this step existed, NO gate and NO pre-push hook invoked Playwright:
#     `turbo run test` has no `test:e2e` task, so a wave that reskinned the web
#     surface could ship gate-green and CI-red. The step closes that, but it is
#     off by default because the gate fires on EVERY stop and a browser plus a
#     `next dev` boot is the most expensive thing this repo can run.
#
#     Four properties, because each survives the mutation that defeats the
#     others:
#       (a) armed by the marker file, the suite runs — and runs AFTER the turbo
#           tasks, with a non-default WEB_PORT. Deleting or reordering the step
#           REDs; so does dropping the `WEB_PORT=` prefix, which is what makes a
#           run on a shared box drive another seat's app (reuseExistingServer).
#       (b) UNARMED — the default — the suite does NOT run. This is the case
#           that pins the DEFAULT: making the step unconditional would tax every
#           stop in every derived project, and nothing else here would notice.
#       (c) armed and RED, the stop is BLOCKED as a gate failure. This is the
#           case that survives the "present but toothless" mutation — swapping
#           `|| return 1` for `|| true` leaves (a) and (b) green.
#       (d) the documented env override arms it too. Without this the
#           `-n "${CLAUDE_GATE_E2E:-}"` half of the condition is prose: deleting
#           it REDs nothing, and the manual/one-off path silently stops working.
# ---------------------------------------------------------------------------
begin "the e2e step runs when the marker file arms it, last and on its own port"
F="$ROOT/c13a"; H="$ROOT/h13a"; L="$ROOT/c13a.log"
make_fixture "$F"
: > "$F/.git/claude-gate-e2e"             # arm the wave, the way a seat does
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0
run_gate "$(sid c13a)" "$F" "$H"
assert_eq "exit 0" 0 "$STATUS"
assert_contains "the e2e suite was invoked" "$(cat "$L" 2>/dev/null)" "pnpm invoked: test:e2e"
assert_order "e2e runs AFTER the turbo tasks (most expensive last)" "$L" "turbo run" "test:e2e"
# The step must claim A port; WHICH port — derived per checkout, overridable — is
# case 14's subject. Asserting a literal here is what let one constant be shared
# by two skeletons and every project stamped from them.
assert_ne "e2e claimed a port, not the shared default :3000" 3000 "$(gate_e2e_port "$L")"
assert_ne "…and not an unset one" "<unset>" "$(gate_e2e_port "$L")"

begin "the e2e step is OFF by default — no marker, no env, no Playwright"
F="$ROOT/c13b"; H="$ROOT/h13b"; L="$ROOT/c13b.log"
make_fixture "$F"                          # deliberately NOT armed
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0
run_gate "$(sid c13b)" "$F" "$H"
assert_eq "exit 0" 0 "$STATUS"
assert_not_contains "e2e was NOT invoked" "$(cat "$L" 2>/dev/null)" "pnpm invoked: test:e2e"
assert_contains "the rest of the gate still ran" "$(cat "$L" 2>/dev/null)" "pnpm invoked: turbo run"

begin "an armed e2e run that REDs blocks the stop as a gate failure"
F="$ROOT/c13c"; H="$ROOT/h13c"; L="$ROOT/c13c.log"
make_fixture "$F"
: > "$F/.git/claude-gate-e2e"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm_selective "$H/.local/bin" "$L" 'test:e2e'
run_gate "$(sid c13c)" "$F" "$H"
assert_eq "exit 2 (stop blocked)" 2 "$STATUS"
assert_contains "blames the code path, correctly" "$STDERR" "GATE FAILED"
assert_contains "names the step that failed" "$STDERR" "pnpm: test:e2e reported a failure"
assert_not_contains "not misfiled as a tooling fault" "$STDERR" "TOOLING fault"

begin "CLAUDE_GATE_E2E arms the step too (the documented one-off override)"
F="$ROOT/c13d"; H="$ROOT/h13d"; L="$ROOT/c13d.log"
make_fixture "$F"                          # no marker file — the env var alone
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0
GATE_ENV="CLAUDE_GATE_E2E=1"
run_gate "$(sid c13d)" "$F" "$H"
assert_eq "exit 0" 0 "$STATUS"
assert_contains "the env override armed the e2e step" "$(cat "$L" 2>/dev/null)" "pnpm invoked: test:e2e"

# ---------------------------------------------------------------------------
# 14. THE E2E STEP MUST OWN THE SERVER IT DRIVES (ADR 1038).
#
#     Cases 13a–13d pinned that the step runs, runs last, and runs on "its own
#     port" — where "its own" was the literal 3199. That number was ONE CONSTANT
#     in two skeletons and in every project stamped from them, so on a multi-seat
#     box the second gate to start found 3199 already bound and
#     `reuseExistingServer` handed it the SIBLING repo's app. Both skeletons ship
#     near-identical specs, so that run goes green against the wrong application.
#     Automatically, on every armed stop — a strictly worse version of the
#     forgot-the-flag hazard ADR 1012 exists to prevent.
#
#     Three properties, and each reds a different mutation:
#       (a) the port is DERIVED PER CHECKOUT — not 3000, not a fleet-wide
#           constant, inside 61000-65535, DIFFERENT for a sibling checkout and
#           STABLE across runs of the same one. Re-hardcoding any constant reds
#           the "sibling differs" assertion; a random port reds the stability one.
#       (b) CLAUDE_GATE_WEB_PORT still wins — the documented escape hatch, which
#           a derivation is very easy to accidentally make unconditional.
#       (c) FAIL CLOSED: with a foreign listener on the gate's own port, the gate
#           must FAIL. This is the one that reds if `WEB_E2E_OWN_SERVER=1` is
#           dropped from the gate line, which is precisely the silent
#           substitution — and note that (a) and (b) both stay green through
#           that mutation, which is why (c) is a separate case.
# ---------------------------------------------------------------------------

# A pnpm stub whose `test:e2e` step is an EXECUTABLE STATEMENT of Playwright
# 1.60's MEASURED `webServer` contract (measurement in docs/adr/1038-*.md):
#   port occupied + reuseExistingServer FALSE -> refuses to start, exit 1
#   port occupied + reuseExistingServer TRUE  -> silently drives the foreign
#                                                server and reports ITS verdict
# and `reuseExistingServer` is false exactly when the run declares ownership
# (`WEB_E2E_OWN_SERVER`, or `CI`) — the config's own expression, mirrored here.
# The connect is a REAL one over /dev/tcp against the port the gate chose, so the
# case cannot pass by agreeing with itself about which port that is.
make_pnpm_playwright_contract() { # dir log
  mkdir -p "$1"
  cat > "$1/pnpm" <<EOF
#!$(command -v bash)
{ echo "pnpm invoked: \$*"
  echo "pnpm saw WEB_PORT: \${WEB_PORT:-<unset>}"
  echo "pnpm saw WEB_E2E_OWN_SERVER: \${WEB_E2E_OWN_SERVER:-<unset>}"; } >> "$2"
[ "\$1" = test:e2e ] || exit 0
port="\${WEB_PORT:-3000}"
(exec 3<>/dev/tcp/127.0.0.1/\$port) 2>/dev/null || exit 0   # free: boots its own
if [ -n "\${WEB_E2E_OWN_SERVER:-}\${CI:-}" ]; then
  echo "Error: http://localhost:\$port is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer." >&2
  exit 1
fi
echo "pnpm test:e2e REUSED a server it did not start on \$port" >> "$2"
exit 0
EOF
  chmod +x "$1/pnpm"
}

# Occupy a port for real. A flag file would let the stub lie about the single
# fact this case is about, so bind an actual listener; if something else on the
# box already holds the port, that serves just as well.
LISTENER_PID=""
occupy_port() { # port -> 0 if the port is connectable afterwards
  local rt i=0
  rt=$(command -v node || command -v python3)
  case "$rt" in
    *node)    "$rt" -e "require('net').createServer(c=>c.end()).listen($1,'127.0.0.1')" >/dev/null 2>&1 & LISTENER_PID=$! ;;
    *python3) "$rt" -c "import socket,time
s=socket.socket(); s.bind(('127.0.0.1',$1)); s.listen(5); time.sleep(300)" >/dev/null 2>&1 & LISTENER_PID=$! ;;
  esac
  while [ "$i" -lt 50 ]; do
    (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && return 0
    i=$((i + 1)); sleep 0.1
  done
  return 1
}
free_port() { [ -n "${LISTENER_PID:-}" ] && kill "$LISTENER_PID" 2>/dev/null; LISTENER_PID=""; return 0; }

begin "the e2e port is derived per checkout, not one constant shared by every repo"
F="$ROOT/c14a"; H="$ROOT/h14a"; L="$ROOT/c14a.log"
make_fixture "$F"; : > "$F/.git/claude-gate-e2e"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0
run_gate "$(sid c14a)" "$F" "$H"
PORT_A=$(gate_e2e_port "$L")

# A second checkout on the same box. Up to three of them, and the property is
# "SOME sibling differs" — because a hash maps two distinct paths onto one port
# once in 4536 pairs. That collision is acceptable in production (the run now
# fails CLOSED, and CLAUDE_GATE_WEB_PORT is the escape hatch) but it must NOT be
# a 1-in-4536 false RED in a suite the Stop hook runs on every stop. The mutation
# this case exists to kill — a port that does not depend on the checkout — reds
# all three deterministically, so the tolerance costs nothing.
PORT_B=""; sib=0
while [ "$sib" -lt 3 ]; do
  sib=$((sib + 1))
  F2="$ROOT/c14a-sibling$sib"; L2="$ROOT/c14a-sibling$sib.log"
  make_fixture "$F2"; : > "$F2/.git/claude-gate-e2e"
  make_pnpm "$H/.local/bin" "$L2" 0
  run_gate "$(sid c14a-s$sib)" "$F2" "$H"
  PORT_B=$(gate_e2e_port "$L2")
  [ -n "$PORT_B" ] && [ "$PORT_B" != "$PORT_A" ] && break
done

rm -f "$F/.git/claude-gate-green"                      # the SAME checkout, again
L3="$ROOT/c14a-again.log"; make_pnpm "$H/.local/bin" "$L3" 0
run_gate "$(sid c14a3)" "$F" "$H"
PORT_A2=$(gate_e2e_port "$L3")

assert_ne "the e2e step does NOT run on the framework default :3000" 3000 "$PORT_A"
assert_ne "nor on the fleet-wide constant :3199 this replaced" 3199 "$PORT_A"
assert_port_in_range "the port is in 61000-65535 (dynamic range, above ephemeral)" "$PORT_A" 61000 65535
assert_port_in_range "the sibling checkout's port is in range too" "$PORT_B" 61000 65535
assert_ne "a sibling checkout gets a DIFFERENT port" "$PORT_A" "$PORT_B"
assert_eq "the same checkout gets the SAME port on a later run" "$PORT_A" "$PORT_A2"

begin "CLAUDE_GATE_WEB_PORT still overrides the derived port"
F="$ROOT/c14b"; H="$ROOT/h14b"; L="$ROOT/c14b.log"
make_fixture "$F"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0
GATE_ENV="CLAUDE_GATE_E2E=1 CLAUDE_GATE_WEB_PORT=61234"
run_gate "$(sid c14b)" "$F" "$H"
assert_eq "exit 0" 0 "$STATUS"
assert_eq "the explicit override won over the derivation" 61234 "$(gate_e2e_port "$L")"

begin "the e2e run FAILS CLOSED on a port it does not own"
F="$ROOT/c14c"; H="$ROOT/h14c"; L="$ROOT/c14c.log"
make_fixture "$F"; : > "$F/.git/claude-gate-e2e"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0
run_gate "$(sid c14c-probe)" "$F" "$H"     # green run, only to learn the port
PORT_C=$(gate_e2e_port "$L")
if occupy_port "$PORT_C"; then
  rm -f "$F/.git/claude-gate-green"        # else Skip 2 short-circuits the rerun
  L4="$ROOT/c14c-collision.log"
  make_pnpm_playwright_contract "$H/.local/bin" "$L4"
  run_gate "$(sid c14c)" "$F" "$H"
  free_port
  assert_eq "a foreign listener on the gate's port BLOCKS the stop" 2 "$STATUS"
  assert_contains "reported as a gate failure" "$STDERR" "GATE FAILED"
  assert_contains "Playwright refused to start on the taken port" "$STDERR" "is already used"
  assert_contains "the gate declared it owns the server" "$(cat "$L4" 2>/dev/null)" "pnpm saw WEB_E2E_OWN_SERVER: 1"
  assert_not_contains "and never silently drove the foreign one" "$(cat "$L4" 2>/dev/null)" "REUSED a server it did not start"
else
  notok "could not occupy port ${PORT_C:-<none>} to test fail-closed" "needs node or python3"
fi
# The gate flag is only half the contract — the config has to HONOUR it. That
# half is TypeScript, so this is a text tripwire and nothing more: it asserts the
# one reversion that reinstates the hazard (tying `reuseExistingServer` to `CI`
# alone, which no Stop hook sets), and stays quiet about naming. The behaviour
# itself is MEASURED in docs/adr/1038-*.md, not inferred from this line.
if [ -f "$PW_CONFIG" ]; then
  assert_not_contains "the config does not tie server-ownership to CI alone" \
    "$(tr -d ' ' < "$PW_CONFIG")" "reuseExistingServer:!process.env.CI"
fi

# ---------------------------------------------------------------------------
# 15. SKIP 2 MUST SEE A NEW FILE (ADR 1042).
#
#     The green-state hash was `HEAD + git diff + git diff --cached`, and both
#     diffs see TRACKED paths only. So a turn whose ONLY change is a new file
#     reproduced the hash the previous green run wrote, and the gate exited 0
#     having executed ZERO steps — silently, with no output at all. "Add a new
#     module / test / route" is what a normal turn looks like, so this was never
#     an edge case, and every project stamped from this skeleton inherited it.
#
#     Four runs, because the obvious two-run version passes for the wrong reason:
#       (a) a green run writes the marker — setup, and the control that the
#           marker mechanism still works at all;
#       (b) UNCHANGED tree -> still skips. "Hash more things" is not a fix if it
#           defeats the optimisation it lives inside;
#       (c) ONE new untracked file, nothing tracked touched -> the gate RUNS.
#           This is the defect;
#       (d) EDIT that same untracked file -> the gate RUNS again. This is the one
#           that kills the cheap fix: hashing the untracked NAME LIST alone
#           passes (c) and fails (d), i.e. the first save of a new file would
#           gate and every later edit of it would skip — the same defect one step
#           further in and considerably harder to notice.
# ---------------------------------------------------------------------------
begin "a new-file-only change must gate (skip 2 sees untracked files)"
F="$ROOT/c15"; H="$ROOT/h15"; L="$ROOT/c15.log"
make_fixture "$F"
make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
make_pnpm "$H/.local/bin" "$L" 0

run_gate15() { : > "$L"; run_gate "$(sid "$1")" "$F" "$H"; }

run_gate15 c15a
assert_eq "(a) the first run gates and goes green" 0 "$STATUS"
assert_contains "(a) …and it actually ran its steps" "$(cat "$L" 2>/dev/null)" "pnpm invoked:"

run_gate15 c15b
assert_eq "(b) an UNCHANGED tree still exits 0" 0 "$STATUS"
assert_eq "(b) …and skip 2 still short-circuits (nothing ran)" "" "$(cat "$L" 2>/dev/null)"

printf 'export const brandNew = 1;\n' > "$F/brand-new.ts"   # untracked, nothing else
run_gate15 c15c
assert_contains "(c) a NEW-FILE-ONLY change RUNS the gate (the defect)" \
  "$(cat "$L" 2>/dev/null)" "pnpm invoked:"

printf 'export const brandNew = 2;\n' > "$F/brand-new.ts"   # edit the untracked file
run_gate15 c15d
assert_contains "(d) EDITING that untracked file runs it again (name-list hashing would skip)" \
  "$(cat "$L" 2>/dev/null)" "pnpm invoked:"

# ---------------------------------------------------------------------------
# 16. STEP COVERAGE, DERIVED FROM THE GATE ITSELF (ADR 1042).
#
#     This is the third time this file has been extended for "the guard was not
#     guarding itself" (ADR 1029, ADR 1038, and now case 15), and each previous
#     fix was one more hand-written case. That pattern does not converge: a case
#     gets written for the defect somebody already found, and the step nobody
#     thought about stays unpinned. web-native measured the cost of exactly that
#     — deleting `pnpm audit:gate` from its gate left its suite 25/25 GREEN.
#
#     So this case names no step. It PARSES `gate_commands()` out of the gate
#     under test and asserts, for every step it finds, the three properties a
#     gate step must have:
#
#       (i)   it is INVOKED — not dead code behind a condition nobody meets;
#       (ii)  when it REDs the stop is BLOCKED. This is the "present but
#             toothless" mutation (`|| return 1` -> `|| true`), which leaves
#             every invocation assertion in case 12 green;
#       (iii) when it REDs everything AFTER it is SKIPPED — short-circuiting is
#             the entire reason the order is measured cheapest-first.
#
#     A step added to `gate_commands()` tomorrow is covered the moment it is
#     added, with no edit here. A step DELETED stops being asserted — which is
#     correct, and is why case 12 keeps its own explicitly named
#     `check:gitleaks-pin` / `test:scripts` assertions: deleting those still REDs.
#
#     The e2e step is armed for the whole loop, because an unreachable step
#     cannot be covered and silently contributing zero assertions is precisely
#     the vacuity this case exists to prevent.
# ---------------------------------------------------------------------------
begin "every step in gate_commands() is invoked, blocks when red, and short-circuits"
GATE_STEPS=$(sed -n '/^gate_commands() {/,/^}/p' "$GATE" |
  grep -oE '(^|[[:space:]])pnpm[[:space:]]+[A-Za-z0-9:._-]+' | awk '{print $NF}')
step_count=$(printf '%s\n' "$GATE_STEPS" | grep -c .)
# A vacuous derivation is the failure mode of a derived test: if the parse breaks
# (the function renamed, reindented, rewritten) the loop below runs zero times
# and the case reports nothing while looking green.
if [ "$step_count" -ge 3 ]; then
  ok "the step list was derived from gate_commands() (got ${step_count})"
else
  notok "the step list was derived from gate_commands()" "got ${step_count}, expected >= 3"
fi
printf '    derived steps: %s\n' "$(printf '%s ' $GATE_STEPS)"

step_idx=0
for step in $GATE_STEPS; do
  step_idx=$((step_idx + 1))
  F="$ROOT/c16-$step_idx"; H="$ROOT/h16-$step_idx"; L="$ROOT/c16-$step_idx.log"
  make_fixture "$F"
  make_node "$H/.local/share/fnm/node-versions/v24.18.0/installation/bin" v24.18.0
  make_pnpm_selective "$H/.local/bin" "$L" "$step"
  GATE_ENV="CLAUDE_GATE_E2E=1"
  run_gate "$(sid "c16-$step_idx")" "$F" "$H"
  assert_contains "  [$step] is invoked" "$(cat "$L" 2>/dev/null)" "pnpm invoked: ${step}"
  assert_eq "  [$step] blocks the stop when it REDs" 2 "$STATUS"
  assert_contains "  [$step] reds as a gate failure, not a tooling fault" "$STDERR" "GATE FAILED"
  later_ran=0
  seen_self=0
  for other in $GATE_STEPS; do
    if [ "$seen_self" -eq 1 ] &&
       grep -q "pnpm invoked: ${other}" "$L" 2>/dev/null; then
      later_ran=$((later_ran + 1))
    fi
    [ "$other" = "$step" ] && seen_self=1
  done
  assert_eq "  [$step] short-circuits (no later step ran)" 0 "$later_ran"
done

printf '\n  %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
