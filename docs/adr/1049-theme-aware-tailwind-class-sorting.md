# ADR 1049 — Theme-aware Tailwind class sorting: an absolute stylesheet, a real dependency, and one repo-wide re-sort

- **Status:** accepted
- **Date:** 2026-07-28
- **Relates to:** [ADR 0004](0004-theming-token-system.md) (the shared `@theme` tokens
  this teaches the sorter about), `web-native-skeleton` ADR 1042 (the mirrored
  change; the two trees diverge only where noted below)

## Context

`prettier-plugin-tailwindcss` has been in the shared config since the beginning,
and it has **never** been theme-aware in either skeleton. Every `@theme` token —
`bg-background`, `text-muted-foreground`, `border-border` — was treated as an
unknown class and hoisted to the FRONT of the class list, which is the exact
opposite of where a sorted list wants a colour utility.

The failure was silent in the strongest sense: the plugin swallows a failed
stylesheet or `tailwindcss` resolution in a bare `catch` and falls back to its
bundled Tailwind defaults. Nothing warns, nothing exits non-zero, and the sort
keeps happening — it just stops meaning anything. A formatter that is confidently
wrong produces no signal at all.

Two things had kept it that way. The shared config carried a NOTE deferring the
fix to a dependency migration, and that migration has since completed — so the
option was never wired while the note went on reading as though it could not be.
And `apps/web/prettier.config.js` set `tailwindStylesheet: "./app/globals.css"`,
which looked like the fix was already in place. It was a committed silent no-op:
the plugin resolves a relative `tailwindStylesheet` against a base directory, and
for every file under `app/` that path resolved to `apps/web/app/app/globals.css`
and matched nothing.

## Decision

**1. The stylesheet path is ABSOLUTE, computed in the shared config from its own
location.** No relative path can be correct, and this is worth stating precisely
because the previous note in the config got the mechanism half-right. Measured
against `prettier-plugin-tailwindcss@0.6.14`: the base directory is
`dirname(await prettier.resolveConfigFile(filepath))` — the resolved CONFIG
FILE's directory — falling back to `dirname(filepath)` only when no config file
is found. Either way it is not the shared config package's directory, so a
relative path written there is wrong for everything.

**2. `apps/web/prettier.config.js` is DELETED, not repaired.** With an absolute
path in the shared config, a per-app override buys nothing — and it would buy
less than nothing, because the base directory follows the config file. A per-app
config would make `apps/web` theme-aware while every file in `packages/ui`
(where most `className` strings actually live) resolved to the root config and
stayed on stock defaults. One config, one base, one design system, whole repo.

**3. `@repo/tailwind-config` is a REAL dependency of `apps/web` and
`apps/mobile`.** Every CSS entry begins with
`@import "@repo/tailwind-config/theme"`, and the plugin resolves that import from
the stylesheet's directory. Previously only `packages/ui` declared the package,
so the import failed and the whole theme fell back — silently, per above.

**4. `tailwindcss` is a REAL dependency of the repo ROOT.** This one was not
anticipated when the work was scoped, and it is the reason the first cold
measurement still showed tokens hoisted after parts 1–3 were done. The plugin
resolves `tailwindcss/package.json` from the base directory, and the base is the
root (the `"prettier"` key in the root `package.json` is what resolves). Under
pnpm's isolated `node_modules` the root had no `tailwindcss`, so the v4
design-system load threw and was swallowed. The root prettier config genuinely
needs to resolve Tailwind in order to sort Tailwind; declaring it is a statement
of fact, not a workaround.

**5. One repo-wide re-sort, accepted as a single commit.** 15 files, not the 9 the
work was scoped against — the estimate was made against `apps/web` alone, and
fixing the base at the root correctly brought `packages/ui` (2 files) and
`apps/mobile` (4 files) in as well. Wider is the right answer here: the two
skipped areas are precisely where the shared tokens are defined and most heavily
used.

**6. A behavioural regression test, because the failure mode is silence.**
`tooling/prettier-config/index.test.js` formats a class list mixing tokens with
stock utilities and asserts the tokens land IN POSITION rather than at the front.
Two structural assertions (the path is absolute; the path exists) sit alongside
it so a failure names which precondition broke. Disarm-verified: pointing
`tailwindStylesheet` at a non-existent relative path turns both red, and the
behavioural failure message shows the hoisting signature verbatim.

## The measurement trap, recorded because it costs an hour

`prettier --list-different` returned **both** "11 files different" and "0 files
different" for the same files with nothing changed on disk. The plugin caches the
loaded design system under a key of `(packageName, configPath, stylesheetPath)`
and **not** per resolution base, so a second run inside the same process answers
from the cache. Every measurement in this ADR was taken from a COLD process, and
any future one must be too.

## Consequences

- Class lists across the repo now sort with tokens in their proper slots:
  `text-sm text-muted-foreground`, not `text-muted-foreground text-sm`;
  `mt-4 rounded-lg border border-border px-4 py-2 … hover:bg-accent`, not
  `border-border hover:bg-accent mt-4 …`.
- A derived project inherits theme-aware sorting with no wiring. A project that
  moves or renames `apps/web/app/globals.css` must update the one path in
  `tooling/prettier-config/index.js` — and the structural test fails loudly if it
  does not, which is the point of asserting `existsSync`.
- The first `pnpm format` after this change in any derived repo will produce a
  one-time re-sort diff of its own. It is mechanical and reviewable as a single
  commit; splitting it across feature PRs is what makes it painful.
- `@repo/prettier-config` gains a `prettier` devDependency, because its test
  imports `format` rather than asserting on config shape alone.

## Divergence from `web-native-skeleton` (ADR 1042)

Both trees take parts 1–5 identically. Two differences, stated so neither reads
as an oversight:

- This tree's `index.test.js` also guards `importOrderParserPlugins` (the
  jsx-drop regression); web-native carries no such override, so its copy has only
  the theme suite.
- `tooling/prettier-config` in web-native had no test harness at all, so it gains
  `vitest.config.js` and a `test` script alongside the new suite — matching what
  `tooling/eslint` in that tree already does.

## Sources

- `tooling/prettier-config/index.js`, `index.test.js`, `vitest.config.js`,
  `package.json`
- `package.json` (root `tailwindcss` devDependency), `apps/web/package.json`,
  `apps/mobile/package.json` (`@repo/tailwind-config`)
- Deleted: `apps/web/prettier.config.js`
- Plugin internals read at `prettier-plugin-tailwindcss@0.6.14`
  (`dist/index.mjs`): the base-directory derivation, the
  `path.resolve(base, tailwindStylesheet)` call, the
  `${packageName}:${configPath}:${stylesheetPath}` cache key, and the bare
  `catch` around the v4 `__unstable__loadDesignSystem` path
- Measured cold 2026-07-28: `pnpm exec prettier --list-different "**/*.{ts,tsx,md}"`
