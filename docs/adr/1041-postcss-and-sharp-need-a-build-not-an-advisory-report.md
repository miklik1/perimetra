# ADR 1041 — `postcss` and `sharp` need a build, not an advisory report

**Status:** Accepted (2026-07-28) — HQ-ruled default, Martin ratify queued
(do-first doctrine). W15 wave. Landed together with the web-native-skeleton twin,
**ADR 1034**. Follows [ADR 1040](1040-the-blind-tree-nineteen-advisories-and-no-gate.md),
which deliberately left this pair out of its own commit.

## Context

Three high advisories remained after ADR 1040 that a version can close:

- `postcss` — GHSA-6g55-p6wh-862q (arbitrary file read via attacker-controlled
  `sourceMappingURL` in a CSS comment) and GHSA-r28c-9q8g-f849 (path traversal in
  previous-source-map auto-loading, arbitrary `.map` disclosure). Installed
  8.4.31 and 8.5.15; patched `>=8.5.18`.
- `sharp` — GHSA-f88m-g3jw-g9cj, four inherited libvips CVEs (CVE-2026-33327,
  -33328, -35590, -35591). Installed 0.34.5; patched `>=0.35.0`.

Both are one-line pnpm `overrides` like the rest of the ADR 1040 set. They are
in a separate commit because **an advisory report cannot verify either bump**,
and this repo has even less to fall back on than its sibling: it has no
`audit:gate` at all (ADR 1040), its CI audit job is parked, and `pnpm build` is
not in lefthook either. `sharp` ships **prebuilt native binaries**
(`allowBuilds: sharp: false` records that its build scripts are a fallback), so
0.34.5 → 0.35.3 swaps the libvips binary `next/image` optimization actually
executes — and a binary that fails to load produces no advisory at all.

`CLAUDE.md`'s own definition of done already says `pnpm build` must be green.
This ADR is the record that for this pair that line is the _only_ thing standing
between a swapped native binary and a derived project.

## Decision

Bump both as `overrides` (`postcss: ^8.5.23`, `sharp: ^0.35.3`), in their own
commit, with the acceptance criterion being what can actually fail:

1. **`pnpm build`** — the api (`nest build` ×3 deployables), web (`next build`)
   and mobile (`expo export`), run cold. Green: 8/8 tasks, 0 cached.
2. **An image-optimization smoke through the real server**, not through `sharp`'s
   own API — transcoding in isolation proves the binary loads, not that Next
   still delegates to it:

   ```sh
   cd apps/web
   mkdir -p public
   node -e "require('sharp')({create:{width:64,height:64,channels:3,\
     background:{r:200,g:30,b:90}}}).png().toFile('public/__sharp-smoke.png')"
   npx next start -p 62339 &
   curl -sD - -o /tmp/opt.out -H 'Accept: image/webp' \
     'http://127.0.0.1:62339/_next/image?url=%2F__sharp-smoke.png&w=32&q=75'
   head -c 12 /tmp/opt.out | xxd     # expect: RIFF....WEBP
   rm -rf public                     # the fixture is NOT committed
   ```

   Measured 2026-07-28: `HTTP/1.1 200`, `Content-Type: image/webp`, body magic
   `52 49 46 46 … 57 45 42 50` (`RIFF`/`WEBP`), against sharp 0.35.3 / libvips
   8.18.3.

The fixture is deliberately **not committed**: a `public/__sharp-smoke.png` in a
template ships into every derived project forever to serve one manual check.

## Consequences

- High production advisories: 19 → 2, and both remaining ones are argued in
  ADR 1040 (brace-expansion v1 has no fix on its line;
  `@opentelemetry/propagator-jaeger` cannot be overridden alone without splitting
  the OTel core, and is never instantiated).
- **The verification gap is named, not closed.** `build` runs in no local gate
  in this repo and CI is dark, so the next native-dependency bump needs the same
  manual act. Boarded.
- Unreferenced `postcss` / `sharp` copies linger in `node_modules/.pnpm` until a
  store prune. The **lockfile** is the oracle for what resolved
  (`postcss@8.5.23`, `sharp@0.35.3`), not a directory listing.

## Sources

- GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-f88m-g3jw-g9cj.
- `pnpm build` and the `/_next/image` smoke above, run on this box 2026-07-28,
  node 24.16.0 / pnpm 11.5.3 / next 16.2.12 / sharp 0.35.3 / libvips 8.18.3.
