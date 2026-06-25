/**
 * Shared Prettier config (@repo/prettier-config).
 *
 * Ports the repo's base formatting rules and adds import sorting +
 * Tailwind class sorting (t3-turbo pattern). The Tailwind plugin must be
 * listed last so it runs after every other transform.
 *
 * NOTE: prettier-plugin-tailwindcss v4 wants a `tailwindStylesheet` option
 * pointing at each app's CSS entry to sort against the @theme tokens. The
 * apps have no CSS entry points until migration item 3 — wire that option
 * (per-app override) then.
 *
 * @type {import("prettier").Config}
 */
import { createRequire } from "node:module";

// Resolve plugins relative to this package so they're found regardless of the
// consumer's CWD (pnpm installs them under tooling/prettier-config/node_modules).
const require = createRequire(import.meta.url);

export default {
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "all",
  printWidth: 100,
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
