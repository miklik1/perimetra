/**
 * Contract (ADR 0040): every schema table declaring a `pii()` column must be
 * reachable by GDPR export/erasure — via a `PrivacyHandler` registered under
 * `PRIVACY_HANDLERS` (privacy-worker.module.ts), the `PrivacyProcessor`'s
 * built-in core erasure, or the documented Better Auth allowlist below.
 * Registration is convention-only, so a new `pii()` table with no handler
 * would otherwise drop out of export/erasure SILENTLY — this test turns that
 * hole into a named failure (sibling of `scrub.pii-contract.test.ts` in
 * @repo/telemetry, which guards the log-redaction half of the registry).
 *
 * Why source-parsing for the enumeration: `pii()` is identity at runtime (the
 * drizzle column carries no marker — only the string registry knows), and this
 * module may not import domain schemas (`local/no-cross-module-schema-import`;
 * CONTEXT.md "must never"). So, per the telemetry precedent, the schema SOURCE
 * is read off disk (node:fs — ungoverned by boundaries) and the
 * `pii("table.column", …)` registrations + `pgTable("name", …)` declarations
 * are parsed from it. Parse-shape drift fails the vacuous-pass guard, not
 * silence.
 *
 * Why DI metadata for the registrations: Nest composes `PRIVACY_HANDLERS` from
 * exactly the `@Module` metadata read here — the aggregation provider's
 * `inject` array IS the registered-handler list (including anything
 * `pnpm gen module` appends at the `@gen:privacy-*` anchors). A handler
 * "covers" a table when its source imports that table's schema export; the
 * processor's core erasure covers the Better Auth rows it touches directly.
 */
import "reflect-metadata";

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PrivacyWorkerModule } from "./privacy-worker.module.js";
import { PRIVACY_HANDLERS } from "./privacy.tokens.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaRoot = join(here, "../../../../../packages/db/src/schema");

/**
 * Better Auth-owned `pii()` tables INTENTIONALLY outside the handler/core
 * fan-out — an explicit, reasoned list, never silence. Adding a DOMAIN table
 * here is abuse (entries must live in schema/auth — asserted below), and a
 * stale entry (table gained real coverage, or dropped its pii() columns) fails.
 */
const BETTER_AUTH_ALLOWLIST: Record<string, string> = {
  verification:
    "self-expiring token rows (expiresAt) keyed by identifier, not user id — Better Auth " +
    "deletes them on expiry/consumption, so there is no durable store to fan out over",
  invitation:
    "organization-plugin invites: the invitee email need not belong to ANY user row (no " +
    "user-id key to erase by); rows expire/resolve via the Better Auth plugin lifecycle",
};

// ---------------------------------------------------------------------------
// Enumeration: pii() tables + pgTable declarations, parsed from schema source.
// ---------------------------------------------------------------------------

function schemaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return schemaFiles(full);
    // Skip schema tests — a pii("x.y") string inside an assertion is not a registration.
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

/** DB table name -> its drizzle export identifier + owning schema subdir. */
const tablesByName = new Map<string, { exportName: string; schemaDir: string }>();
/** DB table names that declare at least one pii() column. */
const piiTableNames = new Set<string>();

for (const file of schemaFiles(schemaRoot)) {
  const src = readFileSync(file, "utf8");
  const rel = relative(schemaRoot, file);
  const schemaDir = rel.includes(sep) ? rel.split(sep)[0]! : "";
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*=\s*pgTable\(\s*["'](\w+)["']/g)) {
    tablesByName.set(m[2]!, { exportName: m[1]!, schemaDir });
  }
  for (const m of src.matchAll(/\bpii\(\s*["']([^"'.]+)\.[^"']*["']/g)) {
    piiTableNames.add(m[1]!);
  }
}

const sortedPiiTables = [...piiTableNames].sort();

// ---------------------------------------------------------------------------
// Registrations: the PRIVACY_HANDLERS aggregation, read from the same @Module
// metadata Nest composes the worker from.
// ---------------------------------------------------------------------------

type HandlerClass = new (...args: never[]) => unknown;
type ProviderShape = HandlerClass | { provide?: unknown; inject?: unknown[] };

const providers = (Reflect.getMetadata("providers", PrivacyWorkerModule) ?? []) as ProviderShape[];
const aggregation = providers.find(
  (p): p is { provide: unknown; inject: HandlerClass[] } =>
    typeof p === "object" && p !== null && "provide" in p && p.provide === PRIVACY_HANDLERS,
);
const registeredHandlerClasses: HandlerClass[] = aggregation?.inject ?? [];

// ---------------------------------------------------------------------------
// Coverage: which schema exports each registered handler (and the processor's
// built-in core erasure) actually imports.
// ---------------------------------------------------------------------------

const workerModuleSrc = readFileSync(join(here, "privacy-worker.module.ts"), "utf8");

function namedImports(src: string): { names: string[]; specifier: string }[] {
  return [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].map((m) => ({
    names: m[1]!
      .split(",")
      .map((name) => name.replace(/\btype\b/g, "").trim())
      .filter(Boolean),
    specifier: m[2]!,
  }));
}

/** Resolve a handler class registered in the worker module to its source text. */
function handlerSource(className: string): string | undefined {
  const imported = namedImports(workerModuleSrc).find(({ names }) => names.includes(className));
  if (!imported?.specifier.startsWith(".")) return undefined;
  return readFileSync(join(here, imported.specifier).replace(/\.js$/, ".ts"), "utf8");
}

/** `@repo/db/schema/<dir>` named imports of a source file: dir -> identifiers. */
function schemaImports(src: string): Map<string, Set<string>> {
  const byDir = new Map<string, Set<string>>();
  for (const { names, specifier } of namedImports(src)) {
    const m = /^@repo\/db\/schema\/([\w-]+)$/.exec(specifier);
    if (!m) continue;
    const set = byDir.get(m[1]!) ?? new Set<string>();
    for (const name of names) set.add(name);
    byDir.set(m[1]!, set);
  }
  return byDir;
}

/** Handler class name -> the schema exports its source reaches. */
const handlerImports = new Map(
  registeredHandlerClasses.map((cls) => [cls.name, schemaImports(handlerSource(cls.name) ?? "")]),
);
/** Better Auth rows the processor's built-in core erasure touches directly. */
const coreImports = schemaImports(readFileSync(join(here, "privacy.processor.ts"), "utf8"));

/** The mechanism covering a pii table, or undefined — THE contract predicate. */
function coveredBy(tableName: string): string | undefined {
  const table = tablesByName.get(tableName);
  if (!table) return undefined;
  for (const [className, imports] of handlerImports) {
    if (imports.get(table.schemaDir)?.has(table.exportName)) return `PrivacyHandler ${className}`;
  }
  if (coreImports.get(table.schemaDir)?.has(table.exportName)) {
    return "PrivacyProcessor built-in core erasure";
  }
  return undefined;
}

describe("pii() ↔ PrivacyHandler registration contract (ADR 0040)", () => {
  it("parses pii() registrations and pgTable declarations from the db schema source", () => {
    // A moved schema tree or a changed pii()/pgTable call shape would make the
    // per-table contract below vacuously pass — assert the parse found the
    // known registry (same guard as the telemetry pii-contract test).
    expect(sortedPiiTables.length).toBeGreaterThan(0);
    expect(sortedPiiTables).toContain("user");
    expect(tablesByName.get("user")?.schemaDir).toBe("auth");
  });

  it("every pii() qualified name matches a declared pgTable", () => {
    // Guards drift between the hand-typed `pii("table.column", …)` string and
    // the actual table — a misnamed registration would dodge the contract.
    const unknown = sortedPiiTables.filter((table) => !tablesByName.has(table));
    expect(
      unknown,
      `pii() registrations name table(s) with no pgTable declaration: ${unknown.join(", ")} — ` +
        `fix the qualified name(s) in packages/db/src/schema/**`,
    ).toEqual([]);
  });

  it("the PRIVACY_HANDLERS aggregation registers handler classes the module also provides", () => {
    expect(aggregation, "PRIVACY_HANDLERS provider missing from PrivacyWorkerModule").toBeDefined();
    expect(registeredHandlerClasses.length).toBeGreaterThan(0);
    // The reference module's handler anchors the convention.
    expect(registeredHandlerClasses.map((cls) => cls.name)).toContain("ProjectsPrivacyHandler");
    for (const cls of registeredHandlerClasses) {
      expect(typeof cls, `PRIVACY_HANDLERS inject entry ${String(cls)} is not a class`).toBe(
        "function",
      );
      // Injected but never provided = UnknownDependenciesException at worker boot.
      expect(
        providers,
        `${cls.name} is in the PRIVACY_HANDLERS inject array but not in the providers array`,
      ).toContain(cls);
      // Unlocatable source would silently drop the handler from the coverage
      // scan below — fail here with the actual cause instead.
      expect(
        handlerSource(cls.name),
        `cannot resolve ${cls.name} to a source file from privacy-worker.module.ts imports`,
      ).toBeDefined();
    }
    // Pin the handler-coverage branch of `coveredBy` on the reference module:
    // today's pii tables are all core-erased or allowlisted, so without this a
    // broken handler-import scan would never surface until the day it matters.
    expect(coveredBy("project")).toBe("PrivacyHandler ProjectsPrivacyHandler");
  });

  it.each(sortedPiiTables.map((table) => [table]))(
    "pii table `%s` is reachable by GDPR export/erasure",
    (tableName) => {
      const mechanism =
        coveredBy(tableName) ??
        (tableName in BETTER_AUTH_ALLOWLIST ? "documented Better Auth allowlist" : undefined);
      expect(
        mechanism,
        `GDPR hole: table "${tableName}" declares pii() columns but no registered ` +
          `PrivacyHandler (PRIVACY_HANDLERS inject array, privacy-worker.module.ts) imports its ` +
          `schema export, and the PrivacyProcessor core erasure does not touch it. Register a ` +
          `PrivacyHandler for the owning module (\`pnpm gen module\` scaffolds one) — or, for a ` +
          `Better Auth-owned table handled by another mechanism, add a reasoned entry to ` +
          `BETTER_AUTH_ALLOWLIST in this test.`,
      ).toBeDefined();
    },
  );

  it("allowlist entries are Better Auth pii tables not otherwise covered", () => {
    for (const table of Object.keys(BETTER_AUTH_ALLOWLIST)) {
      // The escape hatch is scoped to Better Auth's schema — a domain table
      // belongs behind a handler, never here.
      expect(
        tablesByName.get(table)?.schemaDir,
        `allowlist entry "${table}" is not a Better Auth (schema/auth) table`,
      ).toBe("auth");
      expect(
        piiTableNames.has(table),
        `stale allowlist entry "${table}" — it no longer declares pii() columns; delete it`,
      ).toBe(true);
      expect(
        coveredBy(table),
        `stale allowlist entry "${table}" — it is now covered by ${coveredBy(table)}; delete it`,
      ).toBeUndefined();
    }
  });
});
