# Managing updates in derived projects

How a project stamped out by `node scripts/create-project` keeps receiving
skeleton improvements over its lifetime. The model (ADR 0042) has exactly two
channels — one for **code**, one for **dependency policy** — and one invariant
that makes both work: **the `@repo` workspace scope is never renamed**, so
skeleton-owned files stay byte-comparable between the skeleton and every
derived repo, and merges apply cleanly for years.

## The provenance anchor

`create-project` records where the project came from in `package.json`:

```json
"skeleton": {
  "repo": "git@github.com:miklik1/fullstack-skeleton.git",
  "baseCommit": "<sha of the skeleton HEAD at stamp-out>",
  "createdAt": "<ISO timestamp>"
}
```

`baseCommit` is the merge anchor: every question of the form "what changed
upstream since we forked / since we last merged?" resolves against it. After
each upstream merge, **update `baseCommit` to the skeleton commit you merged**
— it always names the last skeleton state this project absorbed.

A useful trick — diff any path against upstream without leaving the shell:

```sh
git fetch skeleton
git diff $(jq -r .skeleton.baseCommit package.json)..skeleton/main -- <path>
```

(e.g. `-- packages/db` before a merge to preview exactly what you are about to
take, or `-- .github/workflows/ci.yml` to review CI changes in isolation.)

## Channel A — upstream merge (code)

Skeleton code improvements (packages, tooling, CI, Dockerfiles, app-shell
glue) propagate by merging the skeleton remote, Epic-Stack-style.

### One-time setup (step 1 of the post-create checklist)

```sh
git remote add skeleton git@github.com:miklik1/fullstack-skeleton.git
git fetch skeleton
```

### Cadence

- **Quarterly**, as a scheduled chore — small, regular merges stay trivial;
  a three-year gap becomes a rewrite.
- **Immediately on security advisories** affecting skeleton-owned code
  (watch the skeleton repo's releases/security advisories).

### The merge

```sh
git fetch skeleton
# Preview what's coming (full diff, or per-path with the jq trick above):
git log --oneline $(jq -r .skeleton.baseCommit package.json)..skeleton/main

git merge --no-rebase skeleton/main
# ...resolve conflicts (ownership rules below), run the full suite...
pnpm install && pnpm check-types && pnpm lint && pnpm test && pnpm build

# Then move the anchor:
#   package.json -> skeleton.baseCommit = the skeleton/main sha just merged
```

Always **merge, never rebase**: rebasing a derived repo onto the skeleton
rewrites the project's own history and breaks every clone. The merge commit is
also the natural place to document anything you chose not to take.

### Conflict ownership rules

Conflicts are rare while the ownership boundary is respected, and mechanical
when they happen:

| Paths                                                                                                                                     | Owner               | On conflict, prefer                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------- |
| `packages/*`, `tooling/*`, `.github/*`                                                                                                    | **skeleton**        | theirs (`skeleton/main`)           |
| `apps/*` (your product code), `docs/adr/0045+`                                                                                            | **derived project** | ours                               |
| `docs/adr/0001–0044`, `docs/managing-updates.md`, root tooling configs (`turbo.json`, `knip.json`, `renovate.json`, compose, Dockerfiles) | **skeleton**        | theirs, then re-apply local deltas |
| Root `package.json` `name` + `skeleton` field, `.env.local` files (gitignored anyway)                                                     | **derived project** | ours                               |

Practical corollaries:

- **Don't edit skeleton-owned files in a derived repo** unless unavoidable;
  if a `packages/*` change is generally useful, contribute it upstream to the
  skeleton instead — then every project gets it on the next merge.
- Derived projects **own `apps/*`**: the skeleton's apps are reference
  implementations, so expect (and accept) drift there; take upstream app-shell
  changes selectively (`git checkout skeleton/main -- apps/api/src/otel` style
  path checkouts work well).
- **ADR numbering is partitioned**: 0001–0044 (plus any future skeleton ADRs
  below your project's marker) are skeleton-owned and may be updated by
  merges; your decisions start at 0045 (see
  `docs/adr/0000-inherited-from-skeleton.md`, written at stamp-out) and are
  never touched by upstream.
- The `@repo` scope staying put is what keeps this table short: skeleton-owned
  files arrive in merges as clean fast-forward hunks because no project-wide
  rename ever touched them.

## Channel B — shared Renovate preset (dependency policy)

Day-to-day dependency **versions** are Renovate's job in each repo; dependency
**policy** (grouping, schedules, what's pinned, what needs approval, security
posture) is steered centrally from the skeleton via a shareable preset.

Every derived repo's `renovate.json` is just:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>miklik1/fullstack-skeleton//renovate-preset"]
}
```

The skeleton's own `renovate.json` extends the same preset (dogfooding: a bad
policy change breaks the skeleton first). What the preset currently encodes
(`renovate-preset.json` at the skeleton root is the source of truth):

- weekly schedule (Monday pre-6am, Europe/Prague), semantic `chore:` commits,
  dependency dashboard, lockfile maintenance;
- one grouped PR for all non-major updates; majors one-per-package;
- react / react-dom / react-native disabled (they move only with deliberate
  catalog/SDK bumps — ADR 0013);
- the OTel 0.x set grouped into one labeled atomic PR (ADR 0036);
- better-auth behind dashboard approval, with vulnerability/OSV PRs bypassing
  the gate (ADR 0033/0044).

Because presets are fetched at Renovate runtime, a policy change merged to the
skeleton's default branch reaches **all ten projects on their next Renovate
run** — no per-repo PRs, no channel-A merge needed. Derived repos may append
project-specific `packageRules` after the `extends` line; rules later in the
file win, so local exceptions are possible without forking the preset.

Renovate (≥ v39) manages pnpm `catalog:`/`catalogs:` entries in
`pnpm-workspace.yaml` natively — version bumps land in the catalog, exactly
where the skeleton pins them.

## What is deliberately NOT a channel

- **Publishing `@repo/*` to a registry** (GitHub Packages) was considered as
  the primary propagation path (spec §4) and deferred: with ~1 project/year,
  publish/version/changelog overhead exceeds the cost of channel-A merges,
  and workspace linking keeps skeleton development friction-free. The seam
  stays open — packages are already real workspace packages with build steps;
  if the fleet grows past the point where merges hurt, start publishing and
  ADR it then.
- **Scope rename per project** — rejected, see ADR 0042. Identity lives in
  the root package name and app display names.

## Node LTS / framework-major cadence

- **Node**: the skeleton tracks current LTS (engines + `.nvmrc` + CI move
  together, in one skeleton commit); derived projects pick it up via the
  quarterly merge. Don't bump Node locally ahead of the skeleton.
- **Framework majors** (Expo SDK, React, Tailwind, NestJS): always land in
  the skeleton first as a catalog-block change with a migration note in the
  merge commit; derived projects receive them as one reviewable merge instead
  of ten Renovate PRs.
