#!/usr/bin/env bash
# Mutation tests for scripts/check-gitleaks-pin.mjs — the supply-chain pin guard.
#
# WHY THIS FILE EXISTS. The guard shipped with a header referring to "this
# guard's own mutation tests". Those mutations were run BY HAND in a scratch dir
# and never committed, so the guard was in exactly the position it was written to
# fix: a control verified once, by a human, whose weakening reddens nothing. A
# reviewer could loosen the `curl | tar` regex, drop the `verifyIdx > extractIdx`
# ordering check, or delete the digest-format assertion, and the guard would go
# on printing "gitleaks pin OK". This is the wave's own thesis applied to the
# guard itself.
#
# METHOD. Every case takes the REAL `.github/workflows/ci.yml`, applies one
# targeted weakening to a copy in a temp dir, and points the guard at it through
# `CI_WORKFLOW_FILE` (which exists for precisely this). The ledger
# (`scripts/gitleaks-pin.json`) is always the real one — the half-bump cases work
# by moving ci.yml out from under it, which is how a half-bump actually happens.
#
# The baseline case is load-bearing in the other direction: if the guard reddened
# on the unmutated file, every "mutant REDs" assertion below would pass
# vacuously.
#
# Run:  bash scripts/__tests__/check-gitleaks-pin.test.sh
#       (also runs via `pnpm test:scripts`, i.e. lefthook pre-push, the CI lint
#        job and the Stop-hook gate — the same paths the guard itself runs in)

set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# CHECK_GITLEAKS_PIN_PATH points the suite at a WEAKENED COPY of the guard, so
# the suite can itself be proven to RED (mirrors CLAUDE_GATE_PATH in the sibling
# suite; the disarm results are recorded in ADR 1029). The copy needs a
# `scripts/gitleaks-pin.json` beside it, because the guard resolves the ledger
# relative to its own location.
GUARD="${CHECK_GITLEAKS_PIN_PATH:-$ROOT_DIR/scripts/check-gitleaks-pin.mjs}"
CI_SRC="$ROOT_DIR/.github/workflows/ci.yml"
[ -f "$GUARD" ] || { echo "cannot find check-gitleaks-pin.mjs at $GUARD" >&2; exit 1; }
[ -f "$CI_SRC" ] || { echo "cannot find ci.yml at $CI_SRC" >&2; exit 1; }

pass_count=0
fail_count=0

ok()    { pass_count=$((pass_count + 1)); printf '    ok   %s\n' "$1"; }
notok() {
  fail_count=$((fail_count + 1))
  printf '    FAIL %s\n' "$1"
  [ -n "${2:-}" ] && printf '         %s\n' "$2"
  return 0
}

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Apply a node expression `s => …` to ci.yml, writing the mutant to $MUTANT.
# node (not sed/python) because the guard is node and the repo already requires
# it — one runtime, no new dependency for a test that guards a node script.
mutate() { # js-arrow-body
  MUTANT="$TMP/ci.yml"
  node -e '
    const fs = require("node:fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    const out = (eval(process.argv[2]))(src);
    if (out === src) { console.error("MUTATION WAS A NO-OP — the test would be vacuous"); process.exit(3); }
    fs.writeFileSync(process.argv[3], out);
  ' "$CI_SRC" "$1" "$MUTANT" || { notok "mutation applied" "node mutation failed / was a no-op"; return 1; }
}

# Run the guard against a workflow file; sets STATUS and OUTPUT.
run_guard() { # workflow_path
  OUTPUT=$(CI_WORKFLOW_FILE="$1" node "$GUARD" 2>&1)
  STATUS=$?
}

# The whole point: this mutant must RED, and must SAY WHY in a way that names
# the control rather than some downstream symptom.
expect_red() { # label needle js-mutation
  printf '\n  %s\n' "$1"
  mutate "$3" || return 0
  run_guard "$MUTANT"
  if [ "$STATUS" -eq 0 ]; then
    notok "reddens (exit non-zero)" "guard exited 0 — the mutation was NOT caught"
    return 0
  fi
  ok "reddens (exit $STATUS)"
  case "$OUTPUT" in
    *"$2"*) ok "names the control: [$2]" ;;
    *) notok "names the control: [$2]" "got: $(printf '%s' "$OUTPUT" | tr '\n' ' ' | cut -c1-200)" ;;
  esac
}

expect_green() { # label js-mutation
  printf '\n  %s\n' "$1"
  mutate "$2" || return 0
  run_guard "$MUTANT"
  if [ "$STATUS" -eq 0 ]; then
    ok "stays green (exit 0)"
  else
    notok "stays green (exit 0)" "got exit $STATUS: $(printf '%s' "$OUTPUT" | tr '\n' ' ' | cut -c1-200)"
  fi
}

printf 'check-gitleaks-pin.mjs — mutation tests\n'

# ---------------------------------------------------------------------------
# 0. BASELINE. Without this every "mutant REDs" case could pass vacuously
#    (a guard that reddens on everything catches nothing).
# ---------------------------------------------------------------------------
printf '\n  the real, unmutated workflow passes\n'
run_guard "$CI_SRC"
if [ "$STATUS" -eq 0 ]; then ok "exit 0 on the real ci.yml"; else notok "exit 0 on the real ci.yml" "$OUTPUT"; fi
case "$OUTPUT" in *"gitleaks pin OK"*) ok "reports the pin OK" ;; *) notok "reports the pin OK" "$OUTPUT" ;; esac

# ---------------------------------------------------------------------------
# 1. THE CENTRAL CONTROL: the pipe revert. ADR 1028's whole argument is that
#    `curl | tar` is UNVERIFIABLE — it extracts as it streams, so no complete
#    artifact ever exists to hash. A "tidy-up" back to a pipe must RED.
#    Covered in both layouts, because the guard has a branch for each: one line,
#    and the shell line-continuation form the original actually used.
# ---------------------------------------------------------------------------
expect_red "the install step is 'tidied' back into curl | tar (one line)" \
  "pipes curl into tar" \
  's => s.replace(/          curl -sSfL -o[\s\S]*?tar -xz -C "\$RUNNER_TEMP" -f "\$RUNNER_TEMP\/gitleaks.tar.gz" gitleaks\n/, `          curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v\${GITLEAKS_VERSION}/gitleaks_\${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar -xz -C "$RUNNER_TEMP" gitleaks\n`)'

expect_red "the install step is reverted to curl | tar across a line continuation" \
  "pipes curl into tar" \
  's => s.replace(/          curl -sSfL -o[\s\S]*?tar -xz -C "\$RUNNER_TEMP" -f "\$RUNNER_TEMP\/gitleaks.tar.gz" gitleaks\n/, `          curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v\${GITLEAKS_VERSION}/gitleaks_\${GITLEAKS_VERSION}_linux_x64.tar.gz" \\\\\n            | tar -xz -C "$RUNNER_TEMP" gitleaks\n`)'

# ---------------------------------------------------------------------------
# 2. ORDERING. Verifying AFTER extraction exits non-zero having ALREADY written
#    attacker-controlled bytes to disk. This is the `verifyIdx > extractIdx`
#    check — the one an "it still verifies, doesn't it?" review waves through.
# ---------------------------------------------------------------------------
expect_red "verification is moved AFTER extraction" \
  "runs AFTER" \
  's => { const v = `          echo "\${GITLEAKS_SHA256}  $RUNNER_TEMP/gitleaks.tar.gz" | sha256sum -c -\n`; const t = `          tar -xz -C "$RUNNER_TEMP" -f "$RUNNER_TEMP/gitleaks.tar.gz" gitleaks\n`; return s.replace(v + t, t + v); }'

# ---------------------------------------------------------------------------
# 3. The verification line is deleted outright.
# ---------------------------------------------------------------------------
expect_red "the sha256sum verification line is deleted" \
  "verification line is missing" \
  's => s.replace(/.*sha256sum -c -.*\n/, "")'

# ---------------------------------------------------------------------------
# 4. The digest constant itself: gone, or corrupted into something that cannot
#    be a sha256 (a truncated paste, an uppercase copy, a sha1).
# ---------------------------------------------------------------------------
expect_red "the GITLEAKS_SHA256 pin is removed (version-only pin)" \
  "digest pin of ADR 1028 is GONE" \
  's => s.replace(/^ *GITLEAKS_SHA256=.*\n/m, "")'

expect_red "the digest is not a lowercase 64-hex sha256" \
  "not a lowercase 64-hex sha256" \
  's => s.replace(/(GITLEAKS_SHA256=)[0-9a-f]{64}/, "$1DEADBEEF")'

# ---------------------------------------------------------------------------
# 5. THE HALF-BUMP — the failure this guard exists for. Version moves, vetted
#    digest does not; and the mirror case, digest edited without re-download.
#    These two are what make the ledger a tripwire instead of decoration.
# ---------------------------------------------------------------------------
expect_red "the version is bumped without a vetted ledger entry" \
  "NO recorded digest" \
  's => s.replace(/(GITLEAKS_VERSION=)[^\s#]+/, "$18.99.0")'

expect_red "the digest is edited in ci.yml without re-downloading" \
  "DIGEST MISMATCH" \
  's => s.replace(/(GITLEAKS_SHA256=)[0-9a-f]{64}/, "$1" + "a".repeat(64))'

# ---------------------------------------------------------------------------
# 6. The extraction line disappears entirely — the step no longer has the
#    ADR 1028 shape at all.
# ---------------------------------------------------------------------------
expect_red "the tar -xz extraction line is gone" \
  "no longer has the ADR 1028 shape" \
  's => s.replace(/^ *tar -xz .*\n/m, "")'

# ---------------------------------------------------------------------------
# 7. errexit (ADR 1028 precondition 2), and its SCOPE.
#    A `shell:` inside the gitleaks job can disarm the pin and must RED. A
#    `shell:` in an unrelated job cannot, and must NOT — the first form of this
#    rule was file-global and reported an unrelated edit with a message blaming
#    the gitleaks step, which is how a rule gets deleted. Both directions are
#    pinned here so neither can drift back.
# ---------------------------------------------------------------------------
expect_red "a shell: override is added to the gitleaks install step" \
  "inside the \`gitleaks:\` job" \
  's => s.replace(/^      - name: Install gitleaks$/m, "      - name: Install gitleaks\n        shell: zsh")'

expect_red "a job-level defaults.run.shell is added to the gitleaks job" \
  "inside the \`gitleaks:\` job" \
  's => s.replace(/^  gitleaks:$/m, "  gitleaks:\n    defaults:\n      run:\n        shell: zsh")'

expect_green "a shell: in an UNRELATED job does not redden the gitleaks pin guard" \
  's => s.replace(/^  lint:$/m, "  lint:\n    defaults:\n      run:\n        shell: bash")'

# ---------------------------------------------------------------------------
# 8. The job the guard inspects is gone or renamed. Without this the scoping
#    added above could silently degrade into "inspects nothing, always green" —
#    the exact trap a regex-sliced job block fell into during development.
# ---------------------------------------------------------------------------
expect_red "the gitleaks job is renamed, so the guard no longer inspects it" \
  "no \`gitleaks:\` job found" \
  's => s.replace(/^  gitleaks:$/m, "  secretscan:")'

printf '\n  %d passed, %d failed\n\n' "$pass_count" "$fail_count"
[ "$fail_count" -eq 0 ] || exit 1
