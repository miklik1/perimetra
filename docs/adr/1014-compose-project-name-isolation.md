# ADR 1014 — The Compose project name is committed per-project, so perimetra never shares Docker volumes with the skeleton

**Status:** Accepted (2026-07-19) — **Skeleton-authored (channel-A drain of `2f83b8d`, by content; ADR re-authored, not cherry-picked); HQ-ruled, Martin ratify queued.** Extends [ADR 0042](0042-template-lifecycle.md) (the `create-project` stamping contract).

## Context

`docker/compose.yaml` runs perimetra's local dev infrastructure (postgres, redis, centrifugo, minio, mailpit). Its named volumes are namespaced by the **Compose project name**: `postgres-data` becomes `<project>_postgres-data`.

Perimetra's committed `docker/compose.yaml` carried the bare literal `name: fullstack-skeleton` — inherited verbatim at the 2026-06-12 stamp, before this fix existed upstream, and never customised since. Verified by direct read, and by comparing the file against the pre-drain skeleton state: byte-identical.

The gitignored `docker/.env` on this box sets `COMPOSE_PROJECT_NAME=perimetra`, which wins over the compose `name:` field by Compose precedence (`-p` flag > env var > `name:` field > directory). That is what has been masking the problem locally. But `docker/.env` is per-machine and **absent on a fresh clone** — another machine, a CI runner, a teammate seat, or this box after losing the untracked file.

So the gap was live and present, not hypothetical: a fresh clone of perimetra with no `docker/.env` fell back to the committed `fullstack-skeleton` literal and would share a volume namespace with the skeleton repo itself, and with every other skeleton-stamped repo on the same machine in the same state. Cross-project data bleed, with the isolation existing only on boxes that happened to carry an untracked file. This is the root of the cross-project volume collision observed upstream.

Perimetra also still carries `scripts/create-project/` even though perimetra is itself a derived, already-stamped repo. A bare run hits the idempotence guard immediately (`this tree is already stamped`); it would only ever run again under an explicit `--force`. It is retained as channel-A root tooling — kept byte-comparable to the skeleton for cheap future merges, and live machinery for any future project stamped from this codebase as a base.

## Decision

1. **`docker/compose.yaml`'s `name:` becomes `${COMPOSE_PROJECT_NAME:-perimetra}`** — perimetra baked in as the committed fail-safe default, _not_ the skeleton's own literal. The env var still wins when present, so `docker/.env` continues to work as belt-and-braces. An explanatory comment above the line records why a derived repo must never inherit the skeleton's namespace.

2. **Port `create-project`'s guarded rewrite** (`scripts/create-project/index.mjs`), which rewrites the `:-` default to the stamped project's name at stamp time. The guard is the point: if the anchor line has drifted, the stamp **fails loudly** rather than silently leaving every stamped repo on a shared namespace. The anchor regex matches the interpolated form (`name: ${COMPOSE_PROJECT_NAME:-<anything>}`), so it also handles a `--force` re-stamp off a prior name.

## Consequences

- **The fix is retroactive for perimetra itself.** After this lands, a fresh perimetra clone with no `docker/.env` gets `perimetra_postgres-data`, not `fullstack-skeleton_postgres-data`. The collision closes at its root for every future clone, CI run, and teammate seat — not merely for future stamps of _other_ projects, which is how upstream's own framing reads from the skeleton's vantage point.
- `docker/.env`'s `COMPOSE_PROJECT_NAME=perimetra` on this box becomes redundant but harmless: both now agree, so there is no drift to reconcile.
- The `create-project` half is dormant in perimetra by construction, and is not exercised by perimetra's own history. It is carried so the file stays byte-comparable to the skeleton and so a future spin-off inherits the guard.
- No application or runtime code changed — infrastructure configuration only. Correspondingly, no automated gate covers this: `docker/compose.yaml`'s `name:` field and the stamp-time rewrite both sit outside `test` / `check-types` / `build`. Verification is manual.
- **Verification recipe** (run with no env var set, to exercise the committed default): `docker compose -f docker/compose.yaml config` must report `name: perimetra`. Confirmed on this box.

## Sources

- Channel-A drain of skeleton `2f83b8d`.
- [ADR 0042](0042-template-lifecycle.md) — the stamping contract this extends.
- Docker Compose project-name precedence: `-p` flag > `COMPOSE_PROJECT_NAME` env var > `name:` field > directory name.
