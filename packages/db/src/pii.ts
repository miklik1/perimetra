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

/** Bare column names (deduped) — feeds log-redaction path lists. */
export function piiColumnNames(): readonly string[] {
  return [...new Set([...registry].map((q) => q.split(".")[1]!))].sort();
}
