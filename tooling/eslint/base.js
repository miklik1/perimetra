import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import onlyWarn from "eslint-plugin-only-warn";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

import localPlugin from "./local/index.js";

// Monorepo root — `eslint` runs per-package (cwd = the package dir), so element
// patterns are matched against this fixed root, not the cwd. base.js lives at
// `tooling/eslint/base.js`, so the root is two levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const baseConfig = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  // Enforce the ADR 0008 dependency DAG between workspace packages/apps
  // (codified in ADR 0011). `@repo/*` imports resolve into sibling package
  // source via the TypeScript resolver; node_modules imports resolve outside
  // `root-path` and are treated as external (not governed here).
  {
    plugins: { boundaries },
    settings: {
      "boundaries/root-path": repoRoot,
      "boundaries/elements": [
        { type: "app", mode: "full", pattern: "apps/*/**" },
        { type: "api", mode: "full", pattern: "packages/api/**" },
        { type: "api-mocks", mode: "full", pattern: "packages/api-mocks/**" },
        { type: "ui", mode: "full", pattern: "packages/ui/**" },
        { type: "validators", mode: "full", pattern: "packages/validators/**" },
        { type: "utils", mode: "full", pattern: "packages/utils/**" },
        { type: "config", mode: "full", pattern: "packages/config/**" },
        { type: "navigation", mode: "full", pattern: "packages/navigation/**" },
        { type: "store", mode: "full", pattern: "packages/store/**" },
        { type: "auth", mode: "full", pattern: "packages/auth/**" },
        { type: "i18n", mode: "full", pattern: "packages/i18n/**" },
        { type: "telemetry", mode: "full", pattern: "packages/telemetry/**" },
        { type: "flags", mode: "full", pattern: "packages/flags/**" },
        { type: "realtime", mode: "full", pattern: "packages/realtime/**" },
        { type: "model", mode: "full", pattern: "packages/model/**" },
        { type: "engine", mode: "full", pattern: "packages/engine/**" },
        { type: "fixtures", mode: "full", pattern: "packages/fixtures/**" },
        { type: "renderers", mode: "full", pattern: "packages/renderers/**" },
        // @gen:boundaries-elements — `pnpm gen package` injects new elements here.
      ],
      "import/resolver": { typescript: {} },
    },
    rules: {
      // ADR 0011 — public-API encapsulation. `boundaries/dependencies` (below)
      // governs WHICH element types may connect; this rule governs WHICH file
      // inside a package a cross-package import may reach. Without it the
      // wildcard `"./*": "./src/*.ts"` subpath exports let any app/package
      // deep-import a package's internals (e.g. `@repo/auth/token-manager`,
      // bypassing the curated `index.ts` barrel), defeating encapsulation.
      //
      // `eslint-plugin-boundaries` can express entry points, but only by file
      // BASENAME under `mode: "full"` (its `internalPath` collapses to the
      // filename), so it cannot tell a public `index.ts` from an internal
      // `format/index.ts` — and its `entry-point` rule is deprecated in v6.
      // `no-restricted-imports` matches the import SPECIFIER, which is exactly
      // the granularity we want: it allow-lists the published subpaths and
      // blocks every other `@repo/<pkg>/<deep>` path. It governs cross-package
      // edges for free — a package reaches its OWN internals via RELATIVE paths
      // (`./x`, `../x`), never `@repo/<self>/x`, so tests deep-importing their
      // own `src` are untouched; only foreign `@repo/*/<deep>` imports fail.
      //
      // Patterns use gitignore semantics (later `!` patterns re-allow). The base
      // pattern bans every two-segments-deep `@repo/*/**`; the negations re-open
      // exactly the entries each package's `exports` map publishes. Keep this in
      // lockstep with the package `exports` maps.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@repo/*/*",
                "@repo/*/*/**",
                // Re-allow the declared public subpath exports per package.
                // gitignore semantics: a negated child under a denied parent
                // dir only re-opens if the parent dir is itself re-allowed, so
                // nested entries (`a/b/c`) also negate the parent (`a/b`).
                "!@repo/api/react",
                "!@repo/api-mocks/msw",
                "!@repo/auth/react",
                "!@repo/config/constants",
                // @repo/db published subpaths (ADR 0032). NOTE: schema/*
                // per-module entries are allowed one-by-one (not `schema/*`)
                // for app code — a dedicated boundaries rule scoping apps/api
                // modules to their own schema dir is still planned; tooling
                // (drizzle-kit, seeds) uses the package root. `schema` itself
                // is listed because a gitignore-style negation only re-opens a
                // child if its parent is re-allowed.
                "!@repo/db/client",
                "!@repo/db/columns",
                "!@repo/db/pii",
                "!@repo/db/factories",
                "!@repo/db/migrations-path",
                "!@repo/db/schema",
                "!@repo/db/schema/auth",
                "!@repo/db/schema/outbox",
                "!@repo/db/schema/audit",
                "!@repo/db/schema/projects",
                "!@repo/config/env",
                "!@repo/config/env/web",
                "!@repo/config/env/mobile",
                "!@repo/flags/server",
                "!@repo/flags/web",
                "!@repo/flags/web/server",
                "!@repo/flags/native",
                "!@repo/i18n/server",
                "!@repo/i18n/web",
                "!@repo/i18n/web/server",
                "!@repo/i18n/native",
                "!@repo/navigation/contract",
                "!@repo/realtime/centrifuge",
                "!@repo/realtime/react",
                "!@repo/telemetry/web",
                "!@repo/telemetry/native",
                "!@repo/ui/lib",
                "!@repo/ui/lib/*",
                "!@repo/ui/components",
                "!@repo/ui/components/*",
                "!@repo/ui/forms",
                "!@repo/ui/forms/*",
                "!@repo/validators/projects",
                // Tooling-config packages under `tooling/*` (NOT runtime
                // elements): their subpath exports ARE the public API — every
                // `eslint.config.js` / `vitest.config.ts` / tsconfig imports
                // `@repo/eslint-config/node`, `@repo/vitest-config/base`, etc.
                "!@repo/eslint-config/*",
                "!@repo/typescript-config/*",
                "!@repo/prettier-config/*",
                "!@repo/tailwind-config/*",
                "!@repo/vitest-config/*",
                "!@repo/vitest-config/setup",
                "!@repo/vitest-config/setup/*",
                "!@repo/db/schema/releases",
                "!@repo/validators/releases",
                "!@repo/db/schema/catalog-versions",
                "!@repo/validators/catalog-versions",
                "!@repo/db/schema/price-tables",
                "!@repo/validators/price-tables",
                "!@repo/db/schema/quotes",
                "!@repo/validators/quotes",
                // Platform/vendor console contracts (ADR 0062). The assignment
                // table lives in `@repo/db/schema/releases` (already allowed) —
                // no new db subpath; only the validators subpath is new.
                "!@repo/validators/platform",
                // Project site-persistence contract (ADR 0054) — extracted from the
                // skeleton-owned projects.ts so that file stays byte-comparable (ADR 0042).
                "!@repo/validators/project-site",
                // @gen:no-restricted-imports-allow — `pnpm gen package` injects the new package's published subpaths here.
              ],
              message:
                "Deep imports into a package's internals are forbidden (ADR 0011). Import from the package root (e.g. `@repo/auth`) or a declared public subpath (e.g. `@repo/auth/react`). If a module should be public, add it to that package's `exports` map and to the allow-list in tooling/eslint/base.js.",
            },
          ],
        },
      ],
      // Each rule also allows the type to import itself (intra-package relative
      // imports are element-to-element of the same type in v6).
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: [
            // Apps compose everything.
            {
              from: { type: "app" },
              allow: [
                "app",
                "api",
                "api-mocks",
                "ui",
                "validators",
                "utils",
                "config",
                "navigation",
                "store",
                "auth",
                "i18n",
                "telemetry",
                "flags",
                "realtime",
                "model",
                "engine",
                "fixtures",
                "renderers",
                // @gen:app-allow — `pnpm gen package` adds the new package type here.
              ].map((type) => ({ to: { type } })),
            },
            // The data layer depends only on validators/utils/config (ADR 0008).
            // NOTE: `auth` is deliberately absent — `api` must never import
            // `@repo/auth`. Auth depends on api (for the middleware/client types),
            // so the edge runs auth → api only. This rule is the acyclic guard
            // (ADR 0012/0015): adding `@repo/auth` to packages/api fails lint.
            {
              from: { type: "api" },
              allow: ["api", "validators", "utils", "config"].map((type) => ({ to: { type } })),
            },
            // Mock infrastructure (ADR 0018): the framework-agnostic mock route
            // set + dispatcher + MSW adapter. Depends only on contracts +
            // constants; apps wire it into the BFF route handler / MSW. It must
            // NOT depend on `api` (it mirrors the wire contract, not the client).
            {
              from: { type: "api-mocks" },
              allow: ["api-mocks", "validators", "config", "utils"].map((type) => ({
                to: { type },
              })),
            },
            // Auth (cross-cutting concern, ADR 0008/0015): composes the data layer
            // + contracts. The api → auth direction stays disallowed above.
            {
              from: { type: "auth" },
              allow: ["auth", "api", "validators", "utils", "config"].map((type) => ({
                to: { type },
              })),
            },
            // Leaf-ish packages: may use the lowest layers, nothing upward.
            {
              from: { type: "ui" },
              allow: ["ui", "utils", "config"].map((type) => ({ to: { type } })),
            },
            {
              from: { type: "navigation" },
              allow: ["navigation", "utils", "config"].map((type) => ({ to: { type } })),
            },
            // i18n (cross-cutting concern, ADR 0020): owns locale identity + the
            // translation contract. May use the lowest layers; in practice only
            // external deps (next-intl/use-intl/zod/zustand) are needed — the
            // internal allowance is the conservative ceiling. `utils`/`store`
            // stay pure leaves: locale flows as an explicit arg/prop, never an
            // upward import, so the graph stays acyclic.
            {
              from: { type: "i18n" },
              allow: ["i18n", "utils", "config"].map((type) => ({ to: { type } })),
            },
            // Telemetry (cross-cutting concern, ADR 0021): implements the
            // `LogSink` interface that lives in `utils` (the lower leaf), so the
            // edge runs telemetry → utils only — `api → telemetry` must never
            // exist (api logs reach Sentry through the configured sink). Nothing
            // depends on telemetry except the apps.
            {
              from: { type: "telemetry" },
              allow: ["telemetry", "utils", "config"].map((type) => ({ to: { type } })),
            },
            // Flags (cross-cutting concern, ADR 0028): the distinctId is
            // injected at configure time, so `flags → auth` must never exist
            // (the app wires auth's user into flags + telemetry at one spot).
            // Nothing depends on flags except the apps.
            {
              from: { type: "flags" },
              allow: ["flags", "utils", "config"].map((type) => ({ to: { type } })),
            },
            // Realtime (cross-cutting concern, ADR 0029): transport only — the
            // connection token is injected at the composition root, so
            // `realtime → auth` must never exist (the ADR 0028 distinctId
            // rule). Domain event handling stays in the apps; nothing depends
            // on realtime except the apps.
            {
              from: { type: "realtime" },
              allow: ["realtime", "utils", "config"].map((type) => ({ to: { type } })),
            },
            {
              from: { type: "validators" },
              allow: ["validators", "utils"].map((type) => ({ to: { type } })),
            },
            // Pure leaves — only their own package (zustand/zod/etc. are
            // external node_modules, not governed by these element rules).
            { from: { type: "utils" }, allow: [{ to: { type: "utils" } }] },
            { from: { type: "config" }, allow: [{ to: { type: "config" } }] },
            { from: { type: "store" }, allow: [{ to: { type: "store" } }] },
            {
              from: { type: "model" },
              allow: ["model"].map((type) => ({ to: { type } })),
            },
            // The rebuild core (CORE_SPEC §9): model is the zero-dep contract;
            // engine interprets it; fixtures exercises both (delta-0 harness).
            {
              from: { type: "engine" },
              allow: ["engine", "model"].map((type) => ({ to: { type } })),
            },
            {
              from: { type: "fixtures" },
              allow: ["fixtures", "model", "engine", "renderers"].map((type) => ({ to: { type } })),
            },
            // Renderers consume the derived site graph only (I4) — model types
            // + engine result shapes, never catalog/config recomputation.
            {
              from: { type: "renderers" },
              allow: ["renderers", "model", "engine"].map((type) => ({ to: { type } })),
            },
            // @gen:boundaries-rules — `pnpm gen package` injects the new package's dependency rule here.
          ],
        },
      ],
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  // Local custom rules (production-hardened, ported from the first app).
  // All rules use "warn" severity to stay consistent with `eslint-plugin-only-warn`
  // (which downgrades "error" → "warn" at the very end of the chain; registering
  // as "warn" directly makes intent readable in the config without relying on that).
  {
    plugins: { local: localPlugin },
    rules: {
      // Bans direct `date-fns` / `temporal-polyfill` / `@js-temporal/polyfill`
      // imports everywhere. Funnelling through a shared formatting helper prevents
      // the date-fns format-token RangeError crash class.
      // When a shared formatting/i18n package is added, configure
      // `allowedPathFragments` to exempt it:
      //   "local/no-direct-date-imports": ["warn", {
      //     allowedPathFragments: ["/packages/formatting/src/", "/packages/i18n/src/"]
      //   }]
      "local/no-direct-date-imports": "warn",
    },
  },
  {
    // Ban bare `z.iso.datetime()` — Z-only in Zod 4, so it rejects the offset
    // (`+HH:MM`) and naive timestamps real backends serialize, failing the
    // whole-DTO `.parse` at the trust boundary while mock-first CI stays green.
    // Use the `isoDatetime` primitive from `@repo/validators` instead. "warn"
    // per the only-warn convention above; `--max-warnings 0` makes it blocking.
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.type='MemberExpression'][callee.object.object.name='z'][callee.object.property.name='iso'][callee.property.name='datetime'][arguments.length=0]",
          message:
            "Use the isoDatetime primitive from @repo/validators (z.iso.datetime({ offset: true })) — bare z.iso.datetime() is Z-only and rejects offset/naive timestamps from real backends.",
        },
      ],
    },
  },
  {
    // Build/test artifacts — never lint generated output. `coverage/**` holds
    // istanbul's vendored HTML-report scripts (ADR 0025); they carry their own
    // `eslint-disable` directives that trip `--max-warnings 0`.
    ignores: ["dist/**", "coverage/**", ".next/**", ".turbo/**"],
  },
];
