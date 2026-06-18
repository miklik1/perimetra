/**
 * Catalog-version contracts (CORE_SPEC §2) — the immutable vendor catalog
 * store's api↔frontend seam. The persisted `body` is a `@repo/model` `Catalog`;
 * its deep shape is gated server-side at publish (the engine consumes it as
 * data), so it crosses the wire as an opaque `z.unknown()` here rather than a
 * brittle zod mirror of the model contract.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

/** List item — metadata only (the full `Catalog` body is heavy; fetch via GET). */
export const catalogVersionSummarySchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type CatalogVersionSummary = z.infer<typeof catalogVersionSummarySchema>;

/** Detail — includes the full `Catalog` payload (opaque to zod; gated on write). */
export const catalogVersionSchema = catalogVersionSummarySchema.extend({
  body: z.unknown(),
});
export type CatalogVersionDetail = z.infer<typeof catalogVersionSchema>;

/** Publish a new immutable catalog version. `body` is a `Catalog`; the version
 *  is read FROM the body and its structure validated server-side. */
export const publishCatalogVersionSchema = z.object({
  body: z.unknown(),
});
export type PublishCatalogVersionInput = z.infer<typeof publishCatalogVersionSchema>;

export const listCatalogVersionsQuerySchema = cursorQuerySchema;
export type ListCatalogVersionsQuery = z.infer<typeof listCatalogVersionsQuerySchema>;

export const catalogVersionsPageSchema = paginated(catalogVersionSummarySchema);
export type CatalogVersionsPage = z.infer<typeof catalogVersionsPageSchema>;
