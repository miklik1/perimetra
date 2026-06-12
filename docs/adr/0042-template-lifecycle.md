# ADR 0042 — Template lifecycle: stamp-out script, two-channel updates, @repo scope stays

**Status:** Accepted (2026-06-11). Implemented.

## Context

This repo's mission is ~10 derived client projects over ~10 years (spec §1,
§4) — the lifecycle is the product, not an afterthought. Two failure modes
dominate template repos at that horizon: (a) stamp-out is a README of manual
steps, so every project starts with copy-paste drift and shipped dev secrets;
(b) there is no update path, so year-3 projects fossilize on year-0 bugs and a
security fix has to be hand-ported ten times. Any mechanism must also survive
being exercised only ~once a quarter — it has to be boring, documented, and
mostly `git`.

## Decision

**Stamp-out: `node scripts/create-project`** (stdlib-only Node, runs on a
fresh clone before `pnpm install`; flags or interactive). It does exactly
five things: sets the root `package.json` name; records provenance in a
`skeleton` field (`{ repo, baseCommit: rev-parse HEAD, createdAt }`);
generates strong secrets (`crypto.randomBytes(32)`) — `BETTER_AUTH_SECRET`
into `apps/api/.env.local`, Centrifugo API key + HMAC token secret into BOTH
that env file and `docker/centrifugo/config.json` so the pair can never
mismatch, plus a no-secrets-by-design `apps/web/.env.local` scaffold; writes
`docs/adr/0000-inherited-from-skeleton.md` (inherited-ADR list + base commit,
new ADRs start at 0045); and prints a post-create checklist (skeleton remote,
display names, Renovate app, service keys, deploy target). `--fresh-history`
optionally re-inits git with a single provenance commit; the default keeps
full history for archaeology. Idempotence guard: refuses to run twice (the
`skeleton` field is the marker).

**The `@repo` workspace scope is NOT renamed.** Considered and rejected: a
scope rename touches every `package.json` and import in the tree, which (a) is
the single most conflict-generating change possible against future upstream
merges — it would poison channel A permanently for one cosmetic win — and
(b) buys nothing, since `@repo/*` packages are private workspace code, never
published under that name. Scope-stable files diff byte-clean against the
skeleton remote for the life of the project. Project identity = root package
name + app display names.

**ADRs are kept, not reset.** The earlier "reset the ADR log to an inherited
note" idea (spec §4) is refined: inherited ADRs document the architecture the
derived project actually runs, and deleting them would orphan every
`// see ADR 00NN` comment in skeleton-owned code. Instead the 0000 marker
records provenance and partitions numbering: ≤0044 skeleton-owned (updated by
merges, superseded never edited), ≥0045 project-owned (never touched by
merges).

**Updates: exactly two channels** (`docs/managing-updates.md` is the operator
doc):

- **Channel A — upstream merge (code).** `git remote add skeleton <repo>`;
  cadence quarterly + immediately on security advisories; always
  `git merge --no-rebase skeleton/main` (rebase would rewrite the project's
  history). Conflict ownership: skeleton owns `packages/*`, `tooling/*`,
  `.github/*` and root tooling configs; the derived project owns `apps/*`
  and `docs/adr/0045+`. The `skeleton.baseCommit` field is the merge anchor,
  advanced after every merge, and powers the preview trick:
  `git diff $(jq -r .skeleton.baseCommit package.json)..skeleton/main -- <path>`.
- **Channel B — shared Renovate preset (dependency policy).**
  `renovate-preset.json` at the skeleton root; derived repos' entire
  `renovate.json` is `extends: ["github>miklik1/fullstack-skeleton//renovate-preset"]`,
  and the skeleton's own `renovate.json` extends the same preset (dogfooding —
  policy breakage hits the skeleton first). Presets are fetched at Renovate
  runtime, so a policy change on the skeleton's default branch reaches every
  derived repo on its next run with zero per-repo PRs. The preset encodes the
  existing policy (weekly grouped non-majors, majors solo, react/RN frozen to
  catalog bumps) plus: the OTel 0.x set grouped+labeled as one atomic PR (ADR
  0036 — 0.x minors are breaking and the set only works in lockstep), and
  better-auth behind `dependencyDashboardApproval` with vulnerability/OSV PRs
  bypassing the gate (ADR 0033/0044 — deliberate bumps, automatic security).

**Registry publishing of `@repo/*` (spec §4's "primary" channel) is
deliberately deferred**, not built: at ~1 new project/year, the
publish/version/changelog overhead of GitHub Packages exceeds what channel A
costs, and workspace linking keeps skeleton development friction-free. The
packages are already real (built, boundary-enforced), so the seam stays open;
revisit when the fleet makes merges hurt, with a superseding ADR.

## Consequences

- Stamp-out is one command and ~a minute; no derived project can ship the
  dev Better Auth/Centrifugo secrets, and the secret pair shared between env
  and the Centrifugo container cannot drift at birth.
- Upstream merges stay mechanical for years _if_ the ownership boundary is
  respected — the cost is discipline: generally-useful changes must be
  contributed to the skeleton, not patched into a derived `packages/*`.
- Channel B gives fleet-wide dependency-policy steering with no fan-out
  machinery, at the price of runtime coupling to the skeleton repo's
  availability/visibility (the Renovate app must be able to read it).
- Deferring package publishing means app-glue _and_ package fixes both ride
  channel A for now; the quarterly cadence is the regulator that keeps those
  merges small.
- `scripts/create-project` mutates by simple JSON/file rewrites, so it is
  resilient to most skeleton evolution; the integration test (throwaway-copy
  run) is the guard that stamp-out keeps working as the tree changes.

## Sources

- Spec §4 (template lifecycle), §13; plan Phase 8.
- Epic Stack "updating" doc (remote-merge channel precedent) — pattern,
  cadence and ownership rules adapted.
- Renovate docs: shareable config presets (`github>owner/repo//file` syntax,
  runtime fetching), `dependencyDashboardApproval`, `vulnerabilityAlerts`,
  pnpm catalog support (native since v39).
- ADRs 0013 (catalog-block framework bumps), 0033/0044 (better-auth CVE
  policy), 0036 (OTel 0.x lockstep pins).
