# Contributing

How to work in this monorepo: where to put things, the quality gates, and the
conventions. For the _why_ behind each rule, follow the linked
[ADR](./docs/adr/README.md); for the stack overview see
[ARCHITECTURE.md](./ARCHITECTURE.md). This file does not duplicate them.

## Prerequisites & first run

- **Node `>=22.18`** — see [`.nvmrc`](./.nvmrc) (`nvm use`) and `engines` in the root
  `package.json`. The floor is 22.18 because internal packages export TypeScript
  source that Node loads directly at config time (`next.config.js` →
  `@repo/config`, vitest configs → `@repo/vitest-config`) — native type-stripping
  shipped enabled in Node 22.18.
- **pnpm 10** — pinned via `packageManager` in the root `package.json`
  (`corepack enable` will use it automatically).
- iOS sim / Android emulator / Expo Go for mobile work.

```bash
pnpm install                                       # also installs git hooks (lefthook)
cp apps/web/.env.example apps/web/.env.local       # all vars optional; demo runs on mocks
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm dev:web                                       # or: pnpm dev (both apps), pnpm dev:mobile
```

Every env var is optional — with none set, the web demo runs entirely on the
bundled MSW mocks (auth + users). The `.env.example` files document each
validated var (see `@repo/config/env/web` and `@repo/config/env/mobile`).

## Where do I put X?

| I want to add…                | Do this                                                                                                                                                                                                                                                         | Reference            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **A new shared package**      | `pnpm gen package` — scaffolds `packages/<name>` and auto-wires it into eslint boundaries + knip.                                                                                                                                                               | ADR 0008, 0024       |
| **A new API call / resource** | `pnpm gen api-resource` — generates endpoint, validators, query keys, and mock fixtures, wired into `@repo/api` and `@repo/api-mocks`.                                                                                                                          | ADR 0007, 0012, 0018 |
| **A new route / screen**      | `pnpm gen route` — registers a typed route in `@repo/navigation` and scaffolds the web RSC page and/or mobile screen.                                                                                                                                           | ADR 0003, 0022, 0024 |
| **A form**                    | React Hook Form + zod; put the schema in `@repo/validators` (no `@repo/forms` package).                                                                                                                                                                         | ADR 0009             |
| **A validator / schema**      | A zod schema in `@repo/validators`; export the inferred type alongside it.                                                                                                                                                                                      | ADR 0008             |
| **Shared non-React logic**    | Pure TS in `@repo/utils` (logger, formatters, helpers). Data/types → `@repo/api` / `@repo/validators`. Never a new package by hand — use `pnpm gen package`.                                                                                                    | ADR 0008             |
| **Web UI**                    | A shadcn/DOM component in `@repo/ui` (web-only).                                                                                                                                                                                                                | ADR 0001, 0006       |
| **Mobile UI**                 | A React Native component under `apps/mobile/components/` (no shared rendered UI — only logic/types/tokens are shared).                                                                                                                                          | ADR 0006             |
| **UI / client state**         | A Zustand store in `@repo/store` _only_ if state is shared across routes/platforms; otherwise keep it local (component state / context). Server cache → TanStack Query, not a store.                                                                            | ADR 0010             |
| **Error handling**            | Throw `ApiError` at the data seam (kinds: `http` \| `network` \| `parse`; classify with `isUnauthorized`/`isForbidden`/`isNotFound`/… from `@repo/api`). Map to user copy via the catalog in `apps/web/lib/error-messages.ts` (returns an `errors.*` i18n key). | ADR 0014             |
| **A toast / notification**    | Call `toast.success/error/info/warning(...)` from `apps/web/lib/toast.ts` (the app-scoped queue built on `@repo/store`'s `createToastStore`/`createToastApi`). Importable from any layer — including the QueryClient `onError` hook — no prop drilling.         | ADR 0027             |
| **A feature flag**            | Declare it in the typed registry `packages/flags/src/registry.ts` (`FLAGS`), then read it with `useFlag("<key>")` from `@repo/flags/web` (or `@repo/flags/native`).                                                                                             | ADR 0028             |
| **A translatable string**     | Add the key to the ICU catalogs in `packages/i18n/src/messages/` (`en.ts` + `cs.ts` — parity is enforced by a test), read via `useTranslations`.                                                                                                                | ADR 0020             |

## Quality gates

Run before pushing (all run in CI too):

```bash
pnpm lint          # ESLint 9 flat config across the graph (--max-warnings 0)
pnpm check-types   # tsc --noEmit + next typegen across the graph
pnpm test          # Vitest (web + shared) and Jest (mobile) — ADR 0005
pnpm knip          # unused files / exports / deps
```

Web end-to-end (Playwright, runs in MSW mock-mode — ADR 0025):

```bash
pnpm --filter web test:e2e        # headless
pnpm --filter web test:e2e:ui     # Playwright UI mode
```

**Git hooks (lefthook, installed by `pnpm install`):**

- **pre-commit** — Prettier `--write` on staged files only (cheap; committing is
  not a chore).
- **pre-push** — `check:no-orphan-rn`, then `pnpm turbo run lint`, `check-types`
  and `test` (the correctness gates; `build` stays CI-only). Catches a red gate
  locally before it can ride a direct push onto a deploy branch, where CI (PRs +
  push:main only) never runs. Override with `LEFTHOOK=0` or `git push --no-verify`.

**Deep-import rule (ADR 0011):** import packages only through their public entry
(`@repo/auth`), never their internals (`@repo/auth/token-manager`). Enforced by
`eslint-plugin-boundaries` + `no-restricted-imports` in `tooling/eslint/base.js`.
Cross-package dependency direction is enforced by the same plugin — `pnpm gen`
keeps the boundary config and barrels correct as you add packages.

## Commit & PR conventions

Conventional Commits, as seen in `git log`:

```
type(scope): short subject — optional longer detail
```

- **types**: `feat`, `fix`, `refactor`, `chore`, `docs`.
- **scope**: the package/app/concern touched, e.g. `feat(flags): …`,
  `fix(web,config): …`, `chore(tooling): …`.
- Reference the ADR a change implements/closes, e.g. `— ADR 0026` or
  `— closes ADR 0011 gap`.
- New architectural decisions go through an ADR first — see
  [docs/adr/README.md](./docs/adr/README.md).
- PRs follow [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md).

## Dependencies & releases

- **Dependency updates** are automated by Renovate (`renovate.json`): non-major
  updates batch into one weekly PR, majors land separately, and the React /
  React-DOM / React-Native versions are pinned (catalog + pnpm overrides) and
  excluded from auto-bumps. Weekly lockfile maintenance is enabled.
- **No release tooling (Changesets, etc.).** Every package here is `private` and
  unpublished — they are workspace-internal (`workspace:*`) consumers of each
  other, never shipped to a registry — so versioning/changelog automation buys
  nothing. The apps are deployed, not versioned.

## License

Internal/proprietary to **BePositive s.r.o.** The root `package.json` declares
`"license": "UNLICENSED"`; there is no `LICENSE` file, so all rights are
reserved. Do not distribute outside the company.
