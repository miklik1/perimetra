/**
 * Release contracts (CORE_SPEC §3) — the immutable vendor release store's
 * api↔frontend seam. The persisted `body` is a `@repo/model`
 * `ProductModelRelease`; its deep shape is gated server-side at publish
 * (`validateRelease` against the catalog), so it crosses the wire as an opaque
 * `z.unknown()` here rather than a brittle zod mirror of the model contract.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

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
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type ReleaseSummary = z.infer<typeof releaseSummarySchema>;

/** A `ConfigInput` (`@repo/engine`: `Record<string, Value>`) — the configurator's
 *  starting values. Crosses opaquely (values are `unknown`); `gateInput` validates
 *  it against the release server-side at publish, so no brittle zod mirror here. */
export const configInputSchema = z.record(z.string(), z.unknown());
export type ConfigInputDto = z.infer<typeof configInputSchema>;

/** Detail — includes the full `ProductModelRelease` body (the engine runs on it)
 *  and the vendor's `initialInput` example (the configurator's starting config). */
export const releaseSchema = releaseSummarySchema.extend({
  body: z.unknown(),
  initialInput: configInputSchema.nullable(),
});
export type ReleaseDetail = z.infer<typeof releaseSchema>;

/** Publish an immutable release. `body` is a `ProductModelRelease` validated
 *  deeply server-side against the named catalog version; `initialInput` (the
 *  configurator's starting config) is gated against the release via `gateInput`. */
export const publishReleaseSchema = z.object({
  catalogVersion: z.number().int().nonnegative(),
  body: z.unknown(),
  initialInput: configInputSchema.optional(),
});
export type PublishReleaseInput = z.infer<typeof publishReleaseSchema>;

export const listReleasesQuerySchema = cursorQuerySchema.extend({
  status: releaseStatusSchema.optional(),
});
export type ListReleasesQuery = z.infer<typeof listReleasesQuerySchema>;

export const releasesPageSchema = paginated(releaseSummarySchema);
export type ReleasesPage = z.infer<typeof releasesPageSchema>;

// --- Version pin / opt-in upgrade (CORE_SPEC §3, ADR 0064) -------------------

/** A model an org is pinned to for which a NEWER assigned version exists — the
 *  explicit opt-in-upgrade offer the tenant `/admin` surface renders. The pinned
 *  vs latest split lets the UI say "you are on v{pinnedVersion}, v{latestVersion}
 *  is available". `latestCatalogVersion` lets the UI warn before an opt-in that
 *  would cross catalog versions (the engine derives against one catalog, I5). */
export const upgradeOfferSchema = z.object({
  modelId: z.string(),
  pinnedReleaseId: z.string(),
  pinnedVersion: z.number().int(),
  latestReleaseId: z.string(),
  latestVersion: z.number().int(),
  latestCatalogVersion: z.number().int(),
});
export type UpgradeOffer = z.infer<typeof upgradeOfferSchema>;

/** Every model the caller's org has an available upgrade for (vendor-scale: a
 *  handful of models — unpaginated). */
export const upgradeOffersSchema = z.object({
  items: z.array(upgradeOfferSchema),
});
export type UpgradeOffers = z.infer<typeof upgradeOffersSchema>;

/** Opt into a version: move the org's pin for THAT release's model to
 *  `releaseId` (the explicit §3 opt-in). The target must be assigned + published;
 *  the engine's single-catalog rule is pre-flight-checked server-side. */
export const pinVersionSchema = z.object({
  releaseId: z.string().min(1),
});
export type PinVersionInput = z.infer<typeof pinVersionSchema>;
