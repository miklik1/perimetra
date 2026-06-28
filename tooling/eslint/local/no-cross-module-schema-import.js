/**
 * Custom ESLint rule: `no-cross-module-schema-import`.
 *
 * Enforces the ADR 0032 module-schema ownership boundary inside the NestJS api:
 * a module under `apps/api/src/modules/<module>/` may import ONLY its own
 * `@repo/db/schema/<module>` — never another module's schema.
 *
 * Why: the `no-restricted-imports` allow-list in base.js re-opens each published
 * `@repo/db/schema/<x>` subpath GLOBALLY (it can only gate cross-PACKAGE deep
 * imports, by specifier, not WHICH api module reaches WHICH schema). So before
 * this rule any module could `import { user } from "@repo/db/schema/auth"` with
 * no lint error, silently coupling module lifecycles and re-introducing the
 * cross-schema Postgres FK that ADR 0032 forbids. A cross-module row reference
 * must instead be a plain uuid validated via the owning service + a field
 * snapshot (no `.references()`, no foreign schema import) — see the engineering
 * finding "Cross-module reference by snapshot + service-validation (no FK)".
 *
 * The rule is path-driven, so it is INERT outside `apps/api/src/modules/**`
 * (every other file — tooling, migrate.ts, seeds, redaction, sentry init,
 * integration tests under `apps/api/test/**` — keeps full schema access and is
 * untouched). It self-scopes; registering it repo-wide is safe.
 *
 * Sanctioned cross-module readers are declared in the `allow` option (e.g. the
 * privacy module legitimately anonymises the auth `user` row and writes the
 * audit log — it owns the GDPR erasure boundary, ADR 0058). Keep that list
 * minimal: every entry is a deliberate coupling, not a convenience.
 *
 * Rule options (schema index 0):
 *   allow {Record<string, string[]>}
 *     Per-module map of EXTRA schema names that module may import beyond its own.
 *     Default: {}. Example: { privacy: ["auth", "audit"] }.
 *   schemaModulePrefix {string}
 *     The db-schema package subpath prefix. Default: "@repo/db/schema".
 *   moduleDirSegment {string}
 *     The path segment under which api modules live. Default:
 *     "apps/api/src/modules".
 */

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A NestJS api module may import only its own `@repo/db/schema/<module>` (ADR 0032). Cross-module references go by snapshot + service-validation, never a foreign schema import.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "object",
            additionalProperties: { type: "array", items: { type: "string" } },
            description:
              "Per-module map of extra schema names that module may import beyond its own (sanctioned cross-module readers).",
          },
          schemaModulePrefix: {
            type: "string",
            description: "The db-schema subpath prefix (default `@repo/db/schema`).",
          },
          moduleDirSegment: {
            type: "string",
            description:
              "The path segment under which api modules live (default `apps/api/src/modules`).",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      crossModule:
        "Module '{{module}}' imports '{{specifier}}' — a foreign module's schema. " +
        "An api module may import only its own `@repo/db/schema/{{module}}` (ADR 0032). " +
        "Reference another module's row by a plain uuid validated via the owning service + a " +
        "field snapshot (no `.references()`, no cross-schema import). If this coupling is " +
        "deliberate, add it to the rule's `allow` map in tooling/eslint/base.js.",
      barrel:
        "Module '{{module}}' imports the whole `{{specifier}}` schema barrel, reaching every " +
        "module's tables (ADR 0032). Import only `@repo/db/schema/{{module}}` (its own schema).",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allow = options.allow ?? {};
    const schemaModulePrefix = options.schemaModulePrefix ?? "@repo/db/schema";
    const moduleDirSegment = options.moduleDirSegment ?? "apps/api/src/modules";

    const filename = context.filename ?? context.getFilename();
    const normalised = filename.replace(/\\/g, "/");

    // Derive the owning module from the path: `<…>/<moduleDirSegment>/<module>/…`.
    // Outside that tree the rule is inert.
    const dirMatch = normalised.match(
      new RegExp(`/${moduleDirSegment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/]+)/`),
    );
    if (!dirMatch) return {};
    const module = dirMatch[1];
    const allowedSchemas = new Set([module, ...(allow[module] ?? [])]);

    const barrelExact = schemaModulePrefix; // `@repo/db/schema`
    const subpathPrefix = `${schemaModulePrefix}/`; // `@repo/db/schema/`

    function check(node) {
      const source = node && node.source;
      if (!source || typeof source.value !== "string") return;
      const specifier = source.value;

      if (specifier === barrelExact) {
        context.report({ node: source, messageId: "barrel", data: { module, specifier } });
        return;
      }
      if (!specifier.startsWith(subpathPrefix)) return;
      // The schema name is the first path segment after the prefix.
      const schemaName = specifier.slice(subpathPrefix.length).split("/")[0];
      if (!schemaName || allowedSchemas.has(schemaName)) return;
      context.report({ node: source, messageId: "crossModule", data: { module, specifier } });
    }

    return {
      ImportDeclaration: check,
      // Re-exports (`export … from "@repo/db/schema/x"`) leak the boundary too.
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

export default rule;
