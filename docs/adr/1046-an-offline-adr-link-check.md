# ADR 1046 — An offline ADR link check, because the worst dangling pointer is printed by a failing guard

**Status:** Accepted (2026-07-28) — HQ-ruled default, Martin ratify queued
(do-first doctrine). W15 wave. Landed together with the web-native-skeleton twin,
**ADR 1040**.

## Context

ADRs in these repos are cited from three places: from each other, from the
`docs/adr/README.md` index, and — the interesting one — from **code**. A pin
guard prints the ADR that argues for the control it just failed; a workflow
comment points at the decision behind a job; a JSON ledger names its own ADR.

Those citations rot silently. **This repo** was carrying four dangling
ones, and two of them mattered:

```
scripts/check-gitleaks-pin.mjs → docs/adr/1033-gitleaks-pinned-by-sha256-digest.md
scripts/gitleaks-pin.json      → docs/adr/1033-gitleaks-pinned-by-sha256-digest.md
```

That file does not exist. The gitleaks digest-pin ADR is **1028**; 1033 in that
repo is an unrelated decision about cancellations. The first of those two lines
is printed by the pin guard's **own failure message** — so a reader meets it at
the exact moment a security control has just failed, and is sent to a file that
is not the argument for the control they are looking at. That is worse than a
dangling pointer in prose.

This wave produced a fifth, live: the sibling skeleton's ADR 1033 was written
citing `0031-supply-chain-audit-gate.md`, and the file is
`0031-supply-chain-gates.md`. Caught by hand, minutes after writing it — which is
the argument for the check rather than against it.

## Decision

`scripts/check-adr-links.mjs` — Node stdlib only, no network, no dependencies
(the `scripts/check-no-orphan-rn.mjs` shape). Two passes:

1. **Relative links inside `docs/adr/*.md`.** Every `](target)` that is a
   repo-relative path must resolve.
2. **`docs/adr/…md` citations anywhere outside `docs/`** — scripts, workflows,
   config, source. This is the pass that pays for the script.

Wired into `test:scripts`, which the Stop-hook gate already runs.

Four properties are deliberate:

- **Offline and narrow.** It does not resolve http(s) links, anchors, or
  reference-style links: those need the network or a markdown parser. A check
  that needs the network cannot run in a Stop hook — and "a rename lands, the
  reference rots, nothing local notices" is precisely the defect class. Narrow
  and runnable beats broad and unrunnable.
- **Glob citations resolve.** Prose here genuinely writes `docs/adr/1031-*.md` to
  cite an ADR without pinning its slug; those resolve by prefix.
- **`.md` outside `docs/adr` is NOT scanned.** Documentation prose cites ADRs
  loosely ("see ADR 1028"); gating that would mean policing prose rather than
  pointers.
- **Code spans and fenced blocks are stripped before pass 1.** A link inside code
  is not a link, and these ADRs quote markdown at each other — this very document
  shows `[bogus](9999-does-not-exist.md)` as its disarm example. Scanning raw
  source made the check red on its own documentation, which is the fastest way to
  get a check deleted.
- **A vacuous run is a hard failure.** An empty or unreadable `docs/adr` exits 2
  rather than printing OK over zero checks — the failure mode of every derived
  check in this repo's history.

One exemption, and it is keyed on the **target**, never on the file that mentions
it: `docs/adr/0000-inherited-from-skeleton.md` is a path the project generator
_writes into a derived repo_, so asserting it resolves here asserts the wrong
thing about the wrong tree. Keying it per-file would silently cover a real
dangling citation that happened to live in the same generator.

## Consequences

- 407 relative links across 97 ADRs and 7 code citations checked here; 364 links
  across 83 ADRs and 8 citations in the sibling. Both clean.
- The two real dangling citations are repointed at ADR 1028 in the same commit.
- Disarm-verified: planting `[bogus](9999-does-not-exist.md)` in an ADR and
  `// docs/adr/9998-also-missing.md` in a script makes it exit 1 and name both.
- **It cannot catch a citation that resolves to the WRONG ADR.** `docs/adr/
1033-a-cancellation-is-not-a-network-error.md` in the gitleaks guard would pass
  — it exists. This checks that pointers resolve, not that they are apt. A
  renumbering that lands on an occupied number is still a human problem.

## Sources

- The four dangling references the script found on its first run against this
  repo, 2026-07-28.
- The disarm run above, same session.
