# ADR 1002 — The `test` task keeps `dependsOn: ["^build"]`; `^test` is not added (it is redundant here)

**Status:** Accepted (2026-07-09). Relates to ADR 0025 (shared `tooling/vitest-config`) and ADR 0048 (pre-push test gate).

## Context

A false-green cache class was found in Primat Plus (2026-07-09) and fixed in the sibling `web-native-skeleton` (commit `b58d775`): a `test` task with no dependency edge to the packages it consumes can replay a **cached green** result after one of those packages changed and actually turned it red. The question this ADR settles is whether `fullstack-skeleton` has the same hole and needs the same fix.

The two skeletons had different `test` shapes. `web-native` used `dependsOn: ["^test"]`; `fullstack` uses `dependsOn: ["^build"]`. The shapes differ because `fullstack` is a **mixed** monorepo — four packages (`@repo/db`, `@repo/i18n`, `@repo/flags`, `@repo/validators`) have real `build` steps and expose BUILT `dist` subpaths the NestJS api imports at runtime (`@repo/db`, `@repo/i18n/server`, `@repo/flags/server`, `@repo/validators/projects`). Those dists must physically exist before the suite runs on a clean CI machine, so `test` depends on `^build`. (`@repo/ai` also has a build step but is a dormant per-project seam with no current consumer, so no `@repo/ai#build` node is materialized until a project wires it in — at which point `^build` covers it automatically.) `web-native` has no build/dist anywhere.

A static reading suggested the danger: `fullstack` has ten **source-only** packages with no `build` script (`@repo/api`, `@repo/api-mocks`, `@repo/auth`, `@repo/config`, `@repo/navigation`, `@repo/realtime`, `@repo/store`, `@repo/telemetry`, `@repo/ui`, `@repo/utils`), all JIT-consumed from `src`. The worry was that `^build` creates no hash edge for a package that has no `build` task, so a source change in one of them (e.g. `@repo/api`, imported by `apps/web` tests) would leave the consumer's suite cached green — the Primat class, live in `fullstack`.

**That worry is empirically false for this Turborepo version.** Turbo materializes a task node for every `(package, build)` pair reachable through the `^build` edge, **including packages that have no `build` script** — as a `command: <NONEXISTENT>` placeholder that runs nothing but still hashes the package's files and propagates that hash to its dependents. Verified with `pnpm exec turbo run test --dry=json`:

- `@repo/api` has no `build` script, yet `@repo/api#build` is a real node in the graph with `command: <NONEXISTENT>`, an `inputs` set covering all 33 of its `src/` files, and `dependents: ["@repo/auth#test", "mobile#test", "web#test"]`. All ten source-only packages behave identically (a `<NONEXISTENT>` `#build` node over their full source, each feeding the consumer tests that import them).
- Editing `packages/api/src/errors.ts` (a production file) changed `@repo/api#build`'s hash, and that flowed through: `web#test`'s hash changed `dfca9c76… → 035a100d…` and `@repo/auth#test`'s changed too — i.e. those consumer test caches **correctly invalidate** on an `@repo/api` source change. `api#test` (the NestJS backend app, which does not depend on the `@repo/api` client package) correctly did **not** change.

So `fullstack`'s existing `^build` already closes the false-green class across every package boundary — for the five build packages via their real `#build` task, and for the ten source-only packages via their placeholder `#build` node, which hashes exactly the same file set (`$TURBO_DEFAULT$` + `.env*`) that an `#test` node would.

## Decision

Keep `test: { dependsOn: ["^build"] }` in `fullstack`'s `turbo.json`. **Do not add `^test`.**

Adding `^test` would be redundant, not defensive: a source-only package's `#test` node hashes the same files its placeholder `#build` node already hashes, so `^test` introduces no invalidation trigger that `^build` does not already provide. It would only add edges that force every consumer's tests to wait on every dependency's tests on a cold cache — extra serialization for zero correctness gain. The two skeletons stay legitimately different: `web-native` (`["^test"]`) has no dist to build and every package has a `test` task, so `^test` is its natural single edge; `fullstack` (`["^build"]`) must build dists anyway, and that same edge already carries source-only invalidation. Copying `web-native`'s shape into `fullstack` would be cargo-culting.

## Consequences

- No `turbo.json` change. The false-green class the Primat finding describes does not exist in `fullstack` today; `^build` was already sufficient, for a reason (placeholder build-node hashing) that was not obvious from a static read and is worth recording so the next drain does not "fix" a non-bug by adding `^test`.
- `check-types` (also `dependsOn: ["^build"]`) is sound by the identical mechanism: a source-only package's type change bumps its placeholder `#build` hash, invalidating every consumer's `check-types` cache. No follow-on needed there either.
- **Load-bearing assumption (the one risk):** this rests on Turbo materializing and hashing a `<NONEXISTENT>` placeholder `#build` node for script-less packages. That is the behaviour of the Turbo version pinned in `pnpm-lock.yaml`. If a future Turbo major stopped creating those placeholder nodes (so `^build` gave no edge to a build-less package), this decision would flip to needing `^test`, and `check-types` with it. This is tracked as an owed check (vault `Engineering findings — open`): on any Turbo major bump, re-run `pnpm exec turbo run test --dry=json` and assert that every consumed source-only package still appears as a `#build` dependency of its consumers' `#test` tasks with a non-empty `inputs` set. If that assertion ever fails, flip `test` (and `check-types`) to add `^test` (`^check-types`).
- `test:integration` (`["^build"]`, `cache: false`) is unaffected — an uncached task always re-runs and cannot false-green regardless.

## Sources

- `web-native-skeleton` commit `b58d775` and its ADR 1002 (the sibling fix that prompted this check).
- Engineering finding: "a turbo task with no `dependsOn` caches false-green across a package boundary" (Primat Plus, 2026-07-09) — the class this ADR confirms `fullstack` is already immune to.
- Empirical verification: `pnpm exec turbo run test --dry=json` task-graph + hash probe, 2026-07-09 (recorded in the engineering finding on placeholder build-node hashing).
