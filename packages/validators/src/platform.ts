/**
 * Platform/vendor console contracts (CORE_SPEC §3, ADR 0062) — the api↔frontend
 * seam for the cross-tenant operations only the platform operator may run:
 * listing every tenant org and assigning published releases to them. Gated
 * server-side by `PlatformGuard` (Better Auth `user.role==='admin'`); the web
 * mirrors `isPlatformAdmin` from `/v1/me`. Publishing releases/catalog reuses
 * the existing `@repo/validators/{releases,catalog-versions}` contracts (now
 * platform-gated); only the assignment + org-list shapes are new here.
 */
import { z } from "zod";

import { isoDatetime } from "./primitives";

/** A tenant organization, as the vendor console sees it across tenancy. */
export const platformOrganizationSchema = z.object({
  // Better Auth org id (32-char, not a uuid).
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  createdAt: isoDatetime,
});
export type PlatformOrganization = z.infer<typeof platformOrganizationSchema>;

/** Every tenant org — vendor-scale, unpaginated (few orgs; revisit if it grows). */
export const platformOrganizationsSchema = z.object({
  items: z.array(platformOrganizationSchema),
});
export type PlatformOrganizations = z.infer<typeof platformOrganizationsSchema>;

/** One org's currently-pinned active version per model (ADR 0064) — lets the
 *  vendor console badge WHICH assigned version an org actually uses for new work. */
export const orgModelPinSchema = z.object({
  modelId: z.string(),
  pinnedReleaseId: z.string(),
});
export type OrgModelPin = z.infer<typeof orgModelPinSchema>;

/** The release keys (natural "modelId@version") one org is currently assigned,
 *  plus its per-model active pins (ADR 0064 — assignment = availability, pin =
 *  the active version). */
export const releaseAssignmentsSchema = z.object({
  organizationId: z.string().min(1),
  releaseIds: z.array(z.string()),
  pins: z.array(orgModelPinSchema),
});
export type ReleaseAssignments = z.infer<typeof releaseAssignmentsSchema>;

/** Assign a published release to an org (platform-only). The `releaseId` is the
 *  natural key; the service 404s an unknown/unpublished release. */
export const assignReleaseSchema = z.object({
  releaseId: z.string().min(1),
});
export type AssignReleaseInput = z.infer<typeof assignReleaseSchema>;

/**
 * Result of a vendor BROADCAST (CORE_SPEC §3, ADR 0064 fan-out): a newly
 * published release is made available to EVERY org currently on an older
 * version of its model, in one operation — each gets an opt-in upgrade offer
 * (the broadcast NEVER moves a pin). The release key is the path param;
 * `assignedOrgIds` gained the assignment, `skippedOrgIds` already had it (the
 * broadcast is idempotent, so a re-run reports every org as skipped).
 */
export const broadcastAssignResultSchema = z.object({
  releaseId: z.string().min(1),
  assignedOrgIds: z.array(z.string()),
  skippedOrgIds: z.array(z.string()),
});
export type BroadcastAssignResult = z.infer<typeof broadcastAssignResultSchema>;
