import { execSync } from "node:child_process";
import type { PlopTypes } from "@turbo/gen";

/**
 * `@turbo/gen` (Plop) scaffolding generators — ADR 0024 / the 2026-06-04 design.
 *
 * Four generators encode the skeleton's repetitive, convention-bearing tasks as
 * one command each, with the ADR 0008/0011 wiring enforced at creation:
 *
 *   pnpm gen package       — a new `@repo/<name>` package, auto-wired into the
 *                            eslint boundaries DAG (base.js) + knip workspaces.
 *   pnpm gen api-resource  — a zod schema (@repo/validators) + endpoint module
 *                            (@repo/api) + mock route group (@repo/api-mocks),
 *                            mirroring the `users` slice across three packages.
 *   pnpm gen route         — a web RSC page and/or mobile screen, registered in
 *                            the `@repo/navigation` route registry.
 *   pnpm gen module        — a full backend domain module (drizzle schema +
 *                            zod contract + repository/service/controller/
 *                            events + tests), reproducing the §7.8 reference
 *                            resource (`modules/projects`, ADR 0039–0041).
 *
 * File edits inject at dedicated `// @gen:*` anchor comments (see the design),
 * so the injection points are explicit, stable, and reviewable.
 *
 * Run non-interactively with `--args`, e.g.
 *   pnpm gen package --args sandbox "A throwaway" false "utils,validators"
 *   pnpm gen module --args invoices invoice true
 * (answers map positionally to the prompt order below).
 */

const INTERNAL_PACKAGES = [
  "utils",
  "config",
  "validators",
  "store",
  "api",
  "api-mocks",
  "ui",
  "navigation",
  "i18n",
  "telemetry",
] as const;

interface FieldSpec {
  name: string;
  /** zod builder fragment, e.g. `z.string()`. */
  zod: string;
  /** A literal TS expression for a synthetic fixture value (uses `i` in scope). */
  mock: string;
}

/**
 * Parse a light `name:type` field list (e.g. `title:string,views:number`) into
 * zod fragments. Supported types mirror the `userSchema` primitives; unknown
 * types fall back to `z.string()`. An empty list yields a single `title` string
 * field so the generated schema always has a body.
 */
function parseFields(input: string): FieldSpec[] {
  const specs = (input ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): FieldSpec => {
      const [rawName, rawType] = entry.split(":").map((s) => s.trim());
      const name = rawName || "title";
      switch ((rawType || "string").toLowerCase()) {
        case "number":
          return { name, zod: "z.number()", mock: "i * 10" };
        case "int":
          return { name, zod: "z.number().int()", mock: "i" };
        case "boolean":
        case "bool":
          return { name, zod: "z.boolean()", mock: "i % 2 === 0" };
        case "email":
          return { name, zod: "z.email()", mock: "`item${i}@example.com`" };
        case "url":
          return { name, zod: "z.url()", mock: "`https://example.com/${i}`" };
        case "datetime":
        case "date":
          return { name, zod: "isoDatetime", mock: '"2026-01-01T00:00:00.000Z"' };
        case "uuid":
          return { name, zod: "z.uuid()", mock: "crypto.randomUUID()" };
        default:
          return { name, zod: "z.string().min(1)", mock: "`" + name + " ${i}`" };
      }
    });
  return specs.length ? specs : [{ name: "title", zod: "z.string().min(1)", mock: "`title ${i}`" }];
}

/** JS case helpers for action closures (the handlebars helpers are template-only). */
function camelCase(s: string): string {
  return s
    .replace(/[-_\s]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (_, c: string) => c.toLowerCase());
}

function firstSegment(path: string): string {
  return path.replace(/^\/+/, "").split("/")[0] || "index";
}

function parseInternalDeps(input: string): string[] {
  return (input ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d): d is string => (INTERNAL_PACKAGES as readonly string[]).includes(d));
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  // --- Case + formatting helpers (handlebars) ---------------------------------
  plop.setHelper("camelCase", (s: string) =>
    String(s)
      .replace(/[-_\s]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ""))
      .replace(/^(.)/, (_, c: string) => c.toLowerCase()),
  );
  plop.setHelper("pascalCase", (s: string) => {
    const camel = String(s).replace(/[-_\s]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ""));
    return camel.replace(/^(.)/, (_, c: string) => c.toUpperCase());
  });
  plop.setHelper("kebabCase", (s: string) =>
    String(s)
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase(),
  );
  plop.setHelper("snakeCase", (s: string) =>
    String(s)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[-\s]+/g, "_")
      .toLowerCase(),
  );
  // SCREAMING_SNAKE — event-type token constants (`INVOICE_CREATED`).
  plop.setHelper("constantCase", (s: string) =>
    String(s)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[-\s]+/g, "_")
      .toUpperCase(),
  );
  // The first path segment of a route path (`/posts/:id` -> `posts`), used as
  // the web/mobile app directory segment.
  plop.setHelper(
    "routeSegment",
    (path: string) => String(path).replace(/^\/+/, "").split("/")[0] || "index",
  );
  // Emit the registry `params` fragment for a path's `:name` segments, e.g.
  // `/posts/:id` -> `, params: { id: "string" }`. Empty for param-less paths.
  plop.setHelper("routeParams", (path: string) => {
    const names = [...String(path).matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    if (!names.length) return "";
    return `, params: { ${names.map((n) => `${n}: "string"`).join(", ")} }`;
  });
  plop.setHelper("eq", (a: unknown, b: unknown) => a === b);
  plop.setHelper(
    "includesPlatform",
    (platforms: string, target: string) =>
      String(platforms) === "both" || String(platforms) === target,
  );

  // === Generator 1 — package =================================================
  plop.setGenerator("package", {
    description: "A new @repo/<name> package, auto-wired into eslint boundaries + knip.",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Package name (kebab-case, becomes @repo/<name>):",
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) || "Use kebab-case (lowercase, digits, hyphens).",
      },
      { type: "input", name: "description", message: "One-line description:" },
      {
        type: "input",
        name: "needsReact",
        message: "Needs React? (true/false):",
        default: "false",
      },
      {
        type: "input",
        name: "internalDeps",
        message: `Internal deps (comma-separated from: ${INTERNAL_PACKAGES.join(", ")}):`,
        default: "",
      },
    ],
    actions: (answers = {}) => {
      const name = String(answers.name);
      const needsReact = String(answers.needsReact) === "true";
      const internalDeps = parseInternalDeps(String(answers.internalDeps ?? ""));
      // Mutate answers so templates see normalized, derived values.
      answers.needsReact = needsReact;
      answers.internalDeps = internalDeps;
      // The boundaries rule allows the package itself + its internal deps.
      answers.allowList = [name, ...internalDeps];

      const actions: PlopTypes.ActionType[] = [
        {
          type: "add",
          path: "packages/{{kebabCase name}}/package.json",
          templateFile: "templates/package/package.json.hbs",
        },
        {
          type: "add",
          path: "packages/{{kebabCase name}}/tsconfig.json",
          templateFile: "templates/package/tsconfig.json.hbs",
        },
        {
          type: "add",
          path: "packages/{{kebabCase name}}/eslint.config.js",
          templateFile: needsReact
            ? "templates/package/eslint.config.react.js.hbs"
            : "templates/package/eslint.config.node.js.hbs",
        },
        {
          type: "add",
          path: "packages/{{kebabCase name}}/vitest.config.ts",
          templateFile: needsReact
            ? "templates/package/vitest.config.react.ts.hbs"
            : "templates/package/vitest.config.node.ts.hbs",
        },
        {
          type: "add",
          path: "packages/{{kebabCase name}}/src/index.ts",
          templateFile: "templates/package/src/index.ts.hbs",
        },
        {
          type: "add",
          path: "packages/{{kebabCase name}}/src/index.test.ts",
          templateFile: "templates/package/src/index.test.ts.hbs",
        },
        // --- Auto-wire eslint boundaries (ADR 0011) ---
        {
          type: "modify",
          path: "tooling/eslint/base.js",
          pattern: /(\n[ \t]*\/\/ @gen:boundaries-elements[^\n]*)/,
          template:
            '\n        { type: "{{kebabCase name}}", mode: "full", pattern: "packages/{{kebabCase name}}/**" },$1',
        },
        {
          type: "modify",
          path: "tooling/eslint/base.js",
          pattern: /(\n[ \t]*\/\/ @gen:app-allow[^\n]*)/,
          template: '\n                "{{kebabCase name}}",$1',
        },
        {
          type: "modify",
          path: "tooling/eslint/base.js",
          pattern: /(\n[ \t]*\/\/ @gen:boundaries-rules[^\n]*)/,
          template:
            '\n            {\n              from: { type: "{{kebabCase name}}" },\n              allow: [{{#each allowList}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}].map((type) => ({ to: { type } })),\n            },$1',
        },
        // --- Auto-wire knip workspaces ---
        {
          type: "modify",
          path: "knip.json",
          pattern: /(\n[ \t]*\/\/ @gen:workspaces[^\n]*)/,
          template: '\n    "packages/{{kebabCase name}}": {},$1',
        },
      ];

      actions.push(
        () =>
          `\nReminder: any EXTERNAL dependency must be added to a pnpm-workspace.yaml catalog (the generator cannot pick a version), then run \`pnpm install\`.`,
      );

      return actions;
    },
  });

  // === Generator 2 — api-resource ============================================
  plop.setGenerator("api-resource", {
    description:
      "A REST resource across @repo/validators + @repo/api + @repo/api-mocks (the users slice shape).",
    prompts: [
      {
        type: "input",
        name: "resource",
        message: "Resource name (singular, kebab-case, e.g. post):",
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) || "Use singular kebab-case (e.g. post, blog-post).",
      },
      {
        type: "input",
        name: "fields",
        message: "Fields (name:type, comma-separated — e.g. title:string,views:number):",
        default: "title:string",
      },
    ],
    actions: (answers = {}) => {
      answers.fields = parseFields(String(answers.fields ?? ""));

      return [
        // --- @repo/validators ---
        {
          type: "add",
          path: "packages/validators/src/{{kebabCase resource}}.ts",
          templateFile: "templates/api-resource/validators.ts.hbs",
        },
        {
          type: "modify",
          path: "packages/validators/src/index.ts",
          pattern: /(\n[ \t]*\/\/ @gen:exports[^\n]*)/,
          template: '\nexport * from "./{{kebabCase resource}}";$1',
        },
        // --- @repo/api ---
        {
          type: "add",
          path: "packages/api/src/endpoints/{{kebabCase resource}}.ts",
          templateFile: "templates/api-resource/endpoint.ts.hbs",
        },
        {
          type: "modify",
          path: "packages/api/src/keys.ts",
          pattern: /(\n[ \t]*\/\/ @gen:exports[^\n]*)/,
          templateFile: "templates/api-resource/keys.fragment.hbs",
        },
        {
          type: "modify",
          path: "packages/api/src/index.ts",
          pattern: /(\n[ \t]*\/\/ @gen:exports[^\n]*)/,
          template:
            '\nexport { create{{pascalCase resource}}Queries } from "./endpoints/{{kebabCase resource}}";$1',
        },
        // --- @repo/api-mocks ---
        {
          type: "add",
          path: "packages/api-mocks/src/fixtures/{{kebabCase resource}}.ts",
          templateFile: "templates/api-resource/fixtures.ts.hbs",
        },
        {
          type: "add",
          path: "packages/api-mocks/src/handlers/{{kebabCase resource}}.ts",
          templateFile: "templates/api-resource/handler.ts.hbs",
        },
        {
          type: "modify",
          path: "packages/api-mocks/src/config.ts",
          pattern: /(\n[ \t]*\/\/ @gen:imports[^\n]*)/,
          template:
            '\nimport { {{camelCase resource}}Routes } from "./handlers/{{kebabCase resource}}";$1',
        },
        {
          type: "modify",
          path: "packages/api-mocks/src/config.ts",
          pattern: /(\n[ \t]*\/\/ @gen:exports[^\n]*)/,
          template: "\n  {{camelCase resource}}s: {{camelCase resource}}Routes,$1",
        },
        {
          type: "modify",
          path: "packages/api-mocks/src/index.ts",
          pattern: /(\n[ \t]*\/\/ @gen:exports[^\n]*)/,
          template:
            '\nexport { {{camelCase resource}}Routes } from "./handlers/{{kebabCase resource}}";$1',
        },
        () =>
          `\nReminder: to mock "${camelCase(String(answers.resource))}" by default, add its group name to NEXT_PUBLIC_MSW_MOCKS / .env.example.`,
      ];
    },
  });

  // === Generator 3 — route ===================================================
  plop.setGenerator("route", {
    description: "A web RSC page and/or mobile screen, registered in @repo/navigation.",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Route key (camelCase registry key, e.g. posts):",
        validate: (v: string) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(v) || "Use a camelCase identifier.",
      },
      {
        type: "input",
        name: "path",
        message: "Path template (e.g. /posts or /posts/:id):",
        validate: (v: string) => v.startsWith("/") || "Path must start with /.",
      },
      {
        type: "input",
        name: "platforms",
        message: "Platforms (web / mobile / both):",
        default: "both",
      },
      {
        type: "input",
        name: "hasSearch",
        message: "Has search params? (true/false):",
        default: "false",
      },
      { type: "input", name: "authGated", message: "Auth-gated? (true/false):", default: "false" },
    ],
    actions: (answers = {}) => {
      const platforms = String(answers.platforms);
      const hasSearch = String(answers.hasSearch) === "true";
      const authGated = String(answers.authGated) === "true";
      answers.hasSearch = hasSearch;
      answers.authGated = authGated;
      const wantsWeb = platforms === "both" || platforms === "web";
      const wantsMobile = platforms === "both" || platforms === "mobile";

      const actions: PlopTypes.ActionType[] = [
        // --- @repo/navigation registry ---
        {
          type: "modify",
          path: "packages/navigation/src/routes.ts",
          pattern: /(\n[ \t]*\/\/ @gen:exports[^\n]*)/,
          templateFile: hasSearch
            ? "templates/route/registry.search.fragment.hbs"
            : "templates/route/registry.fragment.hbs",
        },
      ];

      if (wantsWeb) {
        actions.push({
          type: "add",
          path: "apps/web/app/{{routeSegment path}}/page.tsx",
          templateFile: authGated
            ? "templates/route/web.page.authed.tsx.hbs"
            : "templates/route/web.page.tsx.hbs",
        });
        actions.push({
          type: "add",
          path: "apps/web/app/{{routeSegment path}}/{{routeSegment path}}-client.tsx",
          templateFile: "templates/route/web.client.tsx.hbs",
        });
      }

      if (wantsMobile) {
        actions.push({
          type: "add",
          path: "apps/mobile/app/{{routeSegment path}}.tsx",
          templateFile: "templates/route/mobile.screen.tsx.hbs",
        });
      }

      if (authGated) {
        actions.push(
          () =>
            `\nReminder: add "/${firstSegment(String(answers.path))}/:path*" to apps/web/proxy.ts's matcher so the server gate covers this route.`,
        );
      }

      return actions;
    },
  });

  // === Generator 4 — module ==================================================
  plop.setGenerator("module", {
    description:
      "A full backend domain module (db schema + validators + api module + tests) — the §7.8 reference-resource pattern (ADR 0039–0041).",
    prompts: [
      {
        type: "input",
        name: "plural",
        message: "Resource name (plural, kebab-case, e.g. invoices):",
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) || "Use plural kebab-case (e.g. invoices, blog-posts).",
      },
      {
        type: "input",
        name: "singular",
        message: "Singular form (kebab-case, e.g. invoice):",
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) || "Use singular kebab-case (e.g. invoice, blog-post).",
      },
      {
        type: "input",
        name: "realtime",
        message: "Emit realtime events? (worker handler publishing to Centrifugo) (true/false):",
        default: "true",
      },
    ],
    actions: (answers = {}) => {
      const plural = String(answers.plural);
      const realtime = String(answers.realtime) === "true";
      answers.realtime = realtime;

      const actions: PlopTypes.ActionType[] = [
        // --- @repo/db schema (the §7.8 table conventions) ---
        {
          type: "add",
          path: "packages/db/src/schema/{{kebabCase plural}}/index.ts",
          templateFile: "templates/module/schema.ts.hbs",
        },
        {
          type: "modify",
          path: "packages/db/src/schema/index.ts",
          pattern: /(\n[ \t]*\/\/ @gen:schema-exports[^\n]*)/,
          template: '\nexport * from "./{{kebabCase plural}}/index.js";$1',
        },
        // --- @repo/validators contract (single source of field rules) ---
        {
          type: "add",
          path: "packages/validators/src/{{kebabCase plural}}.ts",
          templateFile: "templates/module/validators.ts.hbs",
        },
        {
          type: "modify",
          path: "packages/validators/src/index.ts",
          pattern: /(\n[ \t]*\/\/ @gen:exports[^\n]*)/,
          template: '\nexport * from "./{{kebabCase plural}}";$1',
        },
        // The api imports `@repo/validators/<plural>` at RUNTIME (NodeNext) —
        // the subpath needs a dist mapping like `./projects` has (the `./*`
        // wildcard serves raw `src/*.ts`: fine for bundlers, not for node).
        {
          type: "modify",
          path: "packages/validators/package.json",
          pattern: /("\.\/\*": "\.\/src\/\*\.ts",)/,
          template:
            '$1\n    "./{{kebabCase plural}}": {\n      "types": "./dist/{{kebabCase plural}}.d.ts",\n      "default": "./dist/{{kebabCase plural}}.js"\n    },',
        },
        // --- eslint deep-import allow-list (ADR 0011): the two published
        // subpaths the new module's api code imports ---
        {
          type: "modify",
          path: "tooling/eslint/base.js",
          pattern: /(\n[ \t]*\/\/ @gen:no-restricted-imports-allow[^\n]*)/,
          template:
            '\n                "!@repo/db/schema/{{kebabCase plural}}",\n                "!@repo/validators/{{kebabCase plural}}",$1',
        },
        // --- apps/api module (the §7.8 file dance) ---
        {
          type: "add",
          path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.repository.ts",
          templateFile: "templates/module/repository.ts.hbs",
        },
        {
          type: "add",
          path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.dto.ts",
          templateFile: "templates/module/dto.ts.hbs",
        },
        {
          type: "add",
          path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.tokens.ts",
          templateFile: "templates/module/tokens.ts.hbs",
        },
        {
          type: "add",
          path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.service.ts",
          templateFile: "templates/module/service.ts.hbs",
        },
        {
          type: "add",
          path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.controller.ts",
          templateFile: "templates/module/controller.ts.hbs",
        },
        {
          type: "add",
          path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.module.ts",
          templateFile: "templates/module/module.ts.hbs",
        },
        // --- starter tests (thin copies of the projects tests) ---
        {
          type: "add",
          path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.repository.test.ts",
          templateFile: "templates/module/repository.test.ts.hbs",
        },
        {
          type: "add",
          path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.service.test.ts",
          templateFile: "templates/module/service.test.ts.hbs",
        },
        // --- AppModule wiring ---
        {
          type: "modify",
          path: "apps/api/src/app.module.ts",
          pattern: /(\n[ \t]*\/\/ @gen:api-module-imports[^\n]*)/,
          template:
            '\nimport { {{pascalCase plural}}Module } from "./modules/{{kebabCase plural}}/{{kebabCase plural}}.module.js";$1',
        },
        {
          type: "modify",
          path: "apps/api/src/app.module.ts",
          pattern: /(\n[ \t]*\/\/ @gen:api-modules[^\n]*)/,
          template: "\n    {{pascalCase plural}}Module,$1",
        },
      ];

      if (realtime) {
        actions.push(
          {
            type: "add",
            path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}.events.ts",
            templateFile: "templates/module/events.ts.hbs",
          },
          {
            type: "add",
            path: "apps/api/src/modules/{{kebabCase plural}}/{{kebabCase plural}}-worker.module.ts",
            templateFile: "templates/module/worker-module.ts.hbs",
          },
          // Worker wiring: domain handler modules are imported by
          // OutboxWorkerModule (NOT worker.module.ts) — the EventsProcessor
          // resolves DOMAIN_EVENT_HANDLERS in that module's DI context, and
          // its variadic factory aggregates every handler class (Nest has no
          // true multi-provider; see outbox-worker.module.ts).
          {
            type: "modify",
            path: "apps/api/src/modules/outbox/outbox-worker.module.ts",
            pattern: /(\n[ \t]*\/\/ @gen:worker-module-imports[^\n]*)/,
            template:
              '\nimport { {{pascalCase plural}}WorkerModule } from "../{{kebabCase plural}}/{{kebabCase plural}}-worker.module.js";\nimport { {{pascalCase plural}}EventsHandler } from "../{{kebabCase plural}}/{{kebabCase plural}}.events.js";$1',
          },
          {
            type: "modify",
            path: "apps/api/src/modules/outbox/outbox-worker.module.ts",
            pattern: /(\n[ \t]*\/\/ @gen:worker-modules[^\n]*)/,
            template: "\n    {{pascalCase plural}}WorkerModule,$1",
          },
          {
            type: "modify",
            path: "apps/api/src/modules/outbox/outbox-worker.module.ts",
            pattern: /(\n[ \t]*\/\/ @gen:domain-event-handlers[^\n]*)/,
            template: "\n        {{pascalCase plural}}EventsHandler,$1",
          },
        );
      }

      // Prettier pass over everything the generator touched: the repo's
      // import sorting (@ianvs/prettier-plugin-sort-imports) and printWidth
      // can't be reproduced by templates/injections, so normalize after.
      actions.push(() => {
        const files = [
          `packages/db/src/schema/${plural}/index.ts`,
          "packages/db/src/schema/index.ts",
          `packages/validators/src/${plural}.ts`,
          "packages/validators/src/index.ts",
          "packages/validators/package.json",
          "tooling/eslint/base.js",
          `apps/api/src/modules/${plural}`,
          "apps/api/src/app.module.ts",
          ...(realtime ? ["apps/api/src/modules/outbox/outbox-worker.module.ts"] : []),
        ];
        execSync(`pnpm exec prettier --write ${files.join(" ")}`, {
          cwd: plop.getDestBasePath(),
          stdio: "ignore",
        });
        return `prettier --write over the ${files.length} touched paths`;
      });

      actions.push(() =>
        [
          "",
          `Module "${plural}" scaffolded. Next steps:`,
          "  1. Replace the TODO(gen) example `name` column with the real domain fields",
          `     (packages/db/src/schema/${plural} + packages/validators/src/${plural}.ts,`,
          "     then thread them through the repository/service/DTOs and tests).",
          "  2. Migration: `pnpm --filter @repo/db db:generate`, review the generated SQL",
          "     (lock_timeout header + expand/contract doctrine, ADR 0038), then apply it",
          "     via `pnpm --filter api migrate`.",
          "  3. Stores user data? Wrap PII columns with `pii()` (@repo/db/pii, ADR 0040)",
          "     and register a PrivacyHandler so export/erasure cover the new table.",
          "  4. User-facing? Add i18n messages (@repo/i18n) and web/mobile screens",
          "     (reference: apps/web/app/projects).",
        ].join("\n"),
      );

      return actions;
    },
  });
}
