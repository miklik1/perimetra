/**
 * Project site persistence (step 6.3c, ADR 0054) — a project IS a designed site:
 * the Site graph (terrain/placements/connections) plus the per-instance roster.
 * The roster entry deliberately mirrors `quoteInstanceInputSchema` (release pin +
 * raw config + opaque overrides) so a saved project feeds `quotes.issue` directly;
 * the two contracts stay separate so they can evolve independently.
 *
 * Lives in its OWN file (not the skeleton-owned reference `projects.ts`) so that
 * file stays byte-comparable to upstream for channel-A skeleton drains (ADR 0042) —
 * a project-specific schema appended to a skeleton-owned contract is a standing
 * drain hazard (a future path-checkout clobbers it with no conflict to catch it).
 *
 * `site` crosses as an opaque payload (`z.unknown()`) — the engine is the
 * validation gate (I5), and the canvas legitimately saves invalid-but-editable
 * sites (the "two truths" split), so persistence never engine-validates it.
 * `instanceId` keys the roster to the Site's placements (same id space).
 */
import { z } from "zod";

export const projectInstanceSchema = z.object({
  instanceId: z.string().min(1),
  /** "modelId@version" — resolved against the immutable release store on issue. */
  releaseId: z.string().min(1),
  /** ConfigInput (raw per-instance values). */
  input: z.record(z.string(), z.unknown()),
  /** CascadeLayers (tenant/customer/quote overrides) — opaque to the wire. */
  overrides: z.unknown().optional(),
});
export type ProjectInstanceInput = z.infer<typeof projectInstanceSchema>;

/** Response — `site` is null for a project with no designed site yet. */
export const projectSiteSchema = z.object({
  site: z.unknown(),
  instances: z.array(projectInstanceSchema),
});
export type ProjectSite = z.infer<typeof projectSiteSchema>;

/** Request — full-document replace (the canvas holds the whole site in memory). */
export const saveProjectSiteSchema = z.object({
  site: z.unknown(),
  instances: z.array(projectInstanceSchema),
});
export type SaveProjectSiteInput = z.infer<typeof saveProjectSiteSchema>;
