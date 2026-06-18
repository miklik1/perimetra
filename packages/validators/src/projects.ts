/**
 * Project contracts (reference resource, spec §7.8) — the single source of
 * truth for field rules. The api derives nestjs-zod DTOs from these; the web
 * app reuses them for forms (RHF + zodResolver, ADR 0009).
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

export const PROJECT_STATUSES = ["active", "archived"] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** Response shape — what every project endpoint serializes through (strip semantics). */
export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  status: projectStatusSchema,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/**
 * Keyset pagination (spec §8): the shared `{ cursor, limit, sort }` block
 * plus the resource-specific filter. The cursor is a project id — UUIDv7 is
 * time-ordered, so paging by id IS paging by creation time.
 */
export const listProjectsQuerySchema = cursorQuerySchema.extend({
  status: projectStatusSchema.optional(),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const projectsPageSchema = paginated(projectSchema);
export type ProjectsPage = z.infer<typeof projectsPageSchema>;

/**
 * Project site persistence (step 6.3c) — a project IS a designed site: the Site
 * graph (terrain/placements/connections) plus the per-instance roster. The
 * roster entry deliberately mirrors `quoteInstanceInputSchema` (release pin +
 * raw config + opaque overrides) so a saved project feeds `quotes.issue`
 * directly; it stays defined here so the contracts can evolve independently.
 *
 * `site` crosses as an opaque payload (`z.unknown()`) — the engine is the
 * validation gate (I5), and the canvas legitimately saves invalid-but-editable
 * sites (the "two truths" split), so persistence never engine-validates it.
 * `instanceId` keys the roster to the Site's placements (same id space).
 */
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
