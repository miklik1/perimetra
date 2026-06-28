/**
 * PII registry (ADR 0040) — the single source of truth for which columns hold
 * personal data. Drives, without further declarations:
 *
 * - the privacy module's `exportUser` / `eraseUser` fan-out,
 * - pino `redact` paths and the Sentry `beforeSend` scrubber,
 * - review tooling ("which tables does erasure touch?").
 *
 * Usage at schema-definition time:
 *
 * ```ts
 * email: pii("users.email", text("email").notNull()),
 * ```
 *
 * The wrapper is identity at runtime for the column itself — it only records
 * the qualified name. Registration happens at module load, so importing the
 * schema aggregate populates the registry.
 */

const registry = new Set<`${string}.${string}`>();

/** Mark a column as PII. Returns the column builder unchanged. */
export function pii<C>(qualifiedName: `${string}.${string}`, column: C): C {
  registry.add(qualifiedName);
  return column;
}

/** All registered `table.column` names (stable order for snapshots). */
export function piiColumns(): readonly string[] {
  return [...registry].sort();
}

/** Bare column names (deduped) — the DB `snake_case` form. */
export function piiColumnNames(): readonly string[] {
  return [...new Set([...registry].map((q) => q.split(".")[1]!))].sort();
}

/** `snake_case` -> `camelCase`, matching Drizzle field names / JSON body keys. */
function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Bare PII column names in BOTH the DB `snake_case` form AND the `camelCase`
 * form Drizzle rows / JSON bodies actually use — so a literal-path log redactor
 * (pino `redact`, the Sentry key scrubber) matches a MULTI-WORD column
 * (`ip_address` AND `ipAddress`) instead of silently no-op'ing on the casing it
 * didn't emit. Single-word columns collapse to one entry. Deny-by-omission:
 * declaring `pii()` must be the ONLY step needed for redaction (ADR 0040), and
 * that promise breaks if the emitted path never matches the logged key.
 */
export function piiBodyKeys(): readonly string[] {
  return [...new Set(piiColumnNames().flatMap((name) => [name, snakeToCamel(name)]))].sort();
}
