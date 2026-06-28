// @vitest-environment node
// (reads the @repo/db schema source off disk via import.meta.url → needs a real
// file:// URL, which the jsdom environment does not provide.)
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { scrubEvent } from "./scrub";

/**
 * Contract (ADR 0040): every column tagged `pii()` in @repo/db must be redacted
 * by this scrubber — otherwise a personal-data column (say `phone`) would sail
 * into Sentry in the clear. The api-side Sentry init is already registry-driven
 * (it imports `piiColumnNames()` at runtime), but this platform-neutral scrubber
 * HAND-MIRRORS the registry as `SENSITIVE_KEYS` and would drift silently when a
 * new `pii()` column lands.
 *
 * The guard cannot import @repo/db: telemetry stays extension-less (Metro) and
 * the eslint DAG forbids a `telemetry → db` edge (see the vault finding "An
 * extension-less Metro-bound package blocks a NodeNext consumer …"). So it reads
 * the schema SOURCE (node:fs — ungoverned by boundaries) and parses the
 * `pii("table.column", …)` registrations, then asserts the scrubber redacts each
 * bare column name. No module import of db; no resolution-regime conflict.
 */
const REDACTED = "[Filtered]";
const schemaDir = fileURLToPath(new URL("../../db/src/schema", import.meta.url));

function schemaSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return schemaSources(full);
    return entry.name.endsWith(".ts") ? [readFileSync(full, "utf8")] : [];
  });
}

// Bare column names from every `pii("qualified.name", …)` call across the schema.
const piiColumnNames = [
  ...new Set(
    schemaSources(schemaDir).flatMap((src) =>
      [...src.matchAll(/\bpii\(\s*["']([^"']+)["']/g)].map((match) => {
        const qualified = match[1] ?? "";
        return qualified.split(".")[1] ?? qualified;
      }),
    ),
  ),
].sort();

describe("pii() ↔ telemetry SENSITIVE_KEYS contract (ADR 0040)", () => {
  it("parses pii() registrations from the db schema source", () => {
    // A moved schema or changed pii() call shape would make the contract below
    // vacuously pass — assert the parse actually found the known registry.
    expect(piiColumnNames.length).toBeGreaterThan(0);
    expect(piiColumnNames).toContain("email");
  });

  it.each(piiColumnNames.map((name) => [name]))(
    "redacts a `%s`-keyed value (registered pii column) wholesale",
    (name) => {
      const scrubbed = scrubEvent({ [name]: "sentinel" }) as Record<string, unknown>;
      expect(scrubbed[name]).toBe(REDACTED);
    },
  );
});
