/**
 * ReleaseDraft contracts (ADR 0068 Phase 3) — the api↔web seam for the MUTABLE
 * author workspace behind the structured release editor. The `body` is the
 * editor's form state (the web `ReleaseDraftInput`), carried OPAQUE
 * (`z.unknown()`): drafts are legitimately incomplete, so only the immutable
 * `POST /v1/releases` publish gate validates the release shape — there is no
 * second validation/freeze path here (I3 untouched).
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

/** List item — the denormalized projection (no heavy `body`). */
export const releaseDraftSummarySchema = z.object({
  id: z.uuid(),
  modelId: z.string().max(200),
  version: z.number().int().nonnegative(),
  catalogVersion: z.number().int().nonnegative().nullable(),
  baseReleaseId: z.string().max(200).nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type ReleaseDraftSummary = z.infer<typeof releaseDraftSummarySchema>;

/** Detail — the summary plus the opaque editor form state. */
export const releaseDraftSchema = releaseDraftSummarySchema.extend({
  body: z.unknown(),
});
export type ReleaseDraft = z.infer<typeof releaseDraftSchema>;

export const createReleaseDraftSchema = z.object({
  modelId: z.string().max(200).default(""),
  version: z.number().int().nonnegative().default(1),
  catalogVersion: z.number().int().nonnegative().nullable().default(null),
  baseReleaseId: z.string().max(200).nullable().default(null),
  /** The editor form state — opaque to the server (validated only at publish).
   *  Optional: a brand-new blank draft has none yet (the service defaults `{}`).
   *  `z.unknown()` is NON-optional in zod v4, so make it explicit. */
  body: z.unknown().optional(),
});
export type CreateReleaseDraftInput = z.infer<typeof createReleaseDraftSchema>;

/** Autosave patch — any subset (the form re-dumps body + denorm each save). */
export const updateReleaseDraftSchema = createReleaseDraftSchema.partial();
export type UpdateReleaseDraftInput = z.infer<typeof updateReleaseDraftSchema>;

/**
 * Keyset pagination (spec §8): the shared `{ cursor, limit, sort }` block. The
 * cursor is a release-draft id — UUIDv7 is time-ordered, so paging by id IS
 * paging by creation time.
 */
export const listReleaseDraftsQuerySchema = cursorQuerySchema;
export type ListReleaseDraftsQuery = z.infer<typeof listReleaseDraftsQuerySchema>;

export const releaseDraftsPageSchema = paginated(releaseDraftSummarySchema);
export type ReleaseDraftsPage = z.infer<typeof releaseDraftsPageSchema>;
