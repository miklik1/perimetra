/**
 * Shared Prettier config (@repo/prettier-config).
 *
 * Ports the repo's base formatting rules and adds import sorting +
 * Tailwind class sorting (t3-turbo pattern). The Tailwind plugin must be
 * listed last so it runs after every other transform.
 *
 * THEME-AWARE class sorting (ADR 1049). `tailwindStylesheet` points the plugin
 * at the repo's canonical CSS entry so `@theme` tokens (`bg-background`,
 * `text-muted-foreground`, …) sort into their proper position instead of being
 * treated as unknown classes and hoisted to the front of every class list.
 *
 * The path MUST be ABSOLUTE. prettier-plugin-tailwindcss resolves a relative
 * `tailwindStylesheet` against the directory of the FILE BEING FORMATTED (it
 * falls back to `dirname(filepath)` when no `tailwind.config.*` exists), NOT
 * against the Prettier config file as its README claims — so no single relative
 * path can be correct for more than one directory, and the one that used to
 * live in `apps/web/prettier.config.js` (`"./app/globals.css"`) resolved to
 * `apps/web/app/app/globals.css` for every file under `app/` and matched
 * nothing. It was a committed silent no-op; it is deleted, not fixed, because
 * an absolute path here serves the whole repo.
 *
 * ONE stylesheet for both apps is correct, not a shortcut: `apps/web` and
 * `apps/mobile` take their tokens from the same
 * `@import "@repo/tailwind-config/theme"`, so the design system the plugin
 * loads is identical either way. That import is why `apps/web` and
 * `apps/mobile` now declare `@repo/tailwind-config` as a REAL dependency —
 * previously only `packages/ui` did, and the plugin swallows a failed
 * `@import` resolution in a bare `catch`, so the whole theme silently fell
 * back to stock Tailwind defaults with no diagnostic.
 *
 * MEASURING A CHANGE HERE: the plugin caches the loaded design system per
 * `(packageName, configPath, stylesheetPath)` and NOT per resolution base, so a
 * second `prettier --list-different` inside the SAME process answers from the
 * cache and can report a different result than the first for identical files on
 * disk (measured: 11-files-different and 0-files-different, no file changed).
 * Always verify from a COLD process.
 *
 * @type {import("prettier").Config}
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Resolve plugins relative to this package so they're found regardless of the
// consumer's CWD (pnpm installs them under tooling/prettier-config/node_modules).
const require = createRequire(import.meta.url);

// Absolute, derived from this file's own location — correct for every formatted
// file in the repo regardless of its directory or prettier's CWD.
const tailwindStylesheet = fileURLToPath(
  new URL("../../apps/web/app/globals.css", import.meta.url),
);

export default {
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "all",
  printWidth: 100,
  tailwindStylesheet,
  plugins: [
    require.resolve("@ianvs/prettier-plugin-sort-imports"),
    require.resolve("prettier-plugin-tailwindcss"),
  ],
  importOrder: ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "", "^@repo/(.*)$", "", "^[./]"],
  // Setting this REPLACES the @ianvs default (["typescript", "jsx"]) — it does
  // not merge — so adding "decorators-legacy" for apps/api (NestJS legacy
  // decorators) silently dropped "jsx", and the sort-imports babel parse then
  // skipped EVERY .tsx file (no import ordering on any component). List all
  // three so decorated .ts AND .tsx are both sorted.
  importOrderParserPlugins: ["typescript", "decorators-legacy", "jsx"],
};
