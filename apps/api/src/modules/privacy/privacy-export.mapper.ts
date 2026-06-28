/**
 * Base GDPR export mapper (ADR 0040, ADR 0041). Every `PrivacyHandler.exportUser`
 * runs its raw DB rows through `stripInternalColumns` before they enter the
 * export document, so a bare `select()` can never ship internal plumbing into a
 * user's Art. 20 download. The api's controllers strip via the zod response
 * schema (ADR 0039); the privacy worker has no controller, so the leak class is
 * closed here instead.
 *
 * STRIPPED (`INTERNAL_EXPORT_KEYS`):
 * - `ownerId` — the interim ownership scope (ADR 0041); every handler filters
 *   `ownerId = userId`, so it is already the export envelope's `userId` — pure
 *   redundancy.
 * - `organizationId` — the live tenancy scope (ADR 0041/0055): which org owns
 *   the row, tenancy plumbing — never the subject's portable personal data.
 * - `deletedAt` — soft-delete plumbing. Soft-deleted rows are still exported
 *   (they remain the subject's data); only the internal marker column is dropped.
 *
 * KEPT: `createdAt` / `updatedAt` — legitimate record metadata the subject is
 * entitled to (Art. 15(1): when their data was created / last changed).
 *
 * Pass `also` for a module-specific internal/actor FK on top of the default set
 * (e.g. a `createdByUserId` actor column that references a third party). Pass
 * `keep` to RESCUE a default-internal column that is meaningful PAYLOAD in this
 * context rather than incidental plumbing (Art. 15/20 intelligibility).
 */
export const INTERNAL_EXPORT_KEYS = ["ownerId", "organizationId", "deletedAt"] as const;

/**
 * Strip the internal columns (`INTERNAL_EXPORT_KEYS` plus any `also`, minus any
 * `keep`) from each raw DB row. Pure — no DB, no module deps. Returns
 * shallow-cloned plain objects (the originals are untouched). A key that is
 * absent on a row is a no-op, so the same default set is safe to apply to every
 * table.
 */
export function stripInternalColumns<T extends Record<string, unknown>>(
  rows: readonly T[],
  also: readonly string[] = [],
  keep: readonly string[] = [],
): Array<Record<string, unknown>> {
  const drop = new Set<string>([...INTERNAL_EXPORT_KEYS, ...also]);
  for (const key of keep) drop.delete(key);
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if (!drop.has(key)) out[key] = row[key];
    }
    return out;
  });
}
