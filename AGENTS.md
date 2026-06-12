# AGENTS.md

Agent instructions for this repository live in [`CLAUDE.md`](./CLAUDE.md) —
that file is the single canonical copy (tool-neutral despite its name; it
predates the multi-agent convention). Read it in full before making changes.

The short version, in case you read nothing else:

- Quality bar: `pnpm check-types && pnpm lint && pnpm test && pnpm build &&
pnpm knip` must stay green (plus `pnpm --filter api test:integration` for
  backend changes).
- Boundaries are ESLint-enforced: no deep imports into packages, api modules
  touch only their own `@repo/db/schema/<module>` entry.
- New backend resources via `pnpm gen module`, not by hand. The reference
  module is `apps/api/src/modules/projects`; each module carries a
  `CONTEXT.md`.
- `apps/api` and `packages/db` are ESM NodeNext — relative imports need `.js`
  extensions.
- Decisions live in `docs/adr/`; deviations get an ADR, never a silent change.
