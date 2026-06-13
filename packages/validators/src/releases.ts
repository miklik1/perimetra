/**
 * Release contracts (CORE_SPEC §3) — the immutable vendor release store's
 * api↔frontend seam. The persisted `body` is a `@repo/model`
 * `ProductModelRelease`; its deep shape is gated server-side at publish
 * (`validateRelease` against the catalog), so it crosses the wire as an opaque
 * `z.unknown()` here rather than a brittle zod mirror of the model contract.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";

/** Mirrors `ReleaseStatus` in @repo/model. */
export const RELEASE_STATUSES = ["draft", "published", "retired"] as const;
export const releaseStatusSchema = z.enum(RELEASE_STATUSES);
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;

/** List item — metadata only (the full release body is heavy; fetch via GET). */
export const releaseSummarySchema = z.object({
  id: z.uuid(),
  /** "modelId@version" — the natural key quote stamps reference (I3). */
  releaseId: z.string(),
  modelId: z.string(),
  version: z.number().int(),
  catalogVersion: z.number().int(),
  status: releaseStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ReleaseSummary = z.infer<typeof releaseSummarySchema>;

/** Detail — includes the full `ProductModelRelease` body (the engine runs on it). */
export const releaseSchema = releaseSummarySchema.extend({
  body: z.unknown(),
});
export type ReleaseDetail = z.infer<typeof releaseSchema>;

/** Publish an immutable release. `body` is a `ProductModelRelease` validated
 *  deeply server-side against the named catalog version. */
export const publishReleaseSchema = z.object({
  catalogVersion: z.number().int().nonnegative(),
  body: z.unknown(),
});
export type PublishReleaseInput = z.infer<typeof publishReleaseSchema>;

export const listReleasesQuerySchema = cursorQuerySchema.extend({
  status: releaseStatusSchema.optional(),
});
export type ListReleasesQuery = z.infer<typeof listReleasesQuerySchema>;

export const releasesPageSchema = paginated(releaseSummarySchema);
export type ReleasesPage = z.infer<typeof releasesPageSchema>;
