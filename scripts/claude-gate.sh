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
state=$( { git rev-parse HEAD; git diff; git diff --cached; } 2>/dev/null | sha1sum | cut -d' ' -f1)
green=.git/claude-gate-green
[ -f "$green" ] && [ "$(cat "$green")" = "$state" ] && exit 0

out=$(pnpm turbo run check-types lint test --output-logs=errors-only 2>&1)
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
