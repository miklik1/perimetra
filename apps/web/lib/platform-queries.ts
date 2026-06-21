import { defineInfiniteQuery, defineMutation, defineQuery } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams } from "@repo/utils";
import {
  assignReleaseSchema,
  broadcastAssignResultSchema,
  catalogVersionSchema,
  catalogVersionsPageSchema,
  platformOrganizationsSchema,
  releaseAssignmentsSchema,
  releaseSchema,
  releasesPageSchema,
  type BroadcastAssignResult,
  type CatalogVersionDetail,
  type CatalogVersionsPage,
  type PlatformOrganizations,
  type ReleaseAssignments,
  type ReleaseDetail,
  type ReleasesPage,
} from "@repo/validators";

/**
 * Platform/vendor console queries (ADR 0062) — the cross-tenant operator surface
 * (`/v1/platform/*`), gated server-side by `PlatformGuard`. The web mirrors
 * `isPlatformAdmin` from `/v1/me` to show/hide the console; the server is the
 * authority. The release LIST here is the GLOBAL picker (every published
 * release), distinct from the tenant `/v1/releases` (assigned-only).
 */
export const platformKeys = {
  all: ["platform"] as const,
  releasesList: () => [...platformKeys.all, "releases", "list"] as const,
  release: (id: string) => [...platformKeys.all, "releases", "detail", id] as const,
  catalogVersionsList: () => [...platformKeys.all, "catalog-versions", "list"] as const,
  catalogVersion: (id: string) => [...platformKeys.all, "catalog-versions", "detail", id] as const,
  organizationsList: () => [...platformKeys.all, "organizations", "list"] as const,
  assignments: (orgId: string) => [...platformKeys.all, "assignments", orgId] as const,
} as const;

export interface AssignVariables {
  orgId: string;
  releaseId: string;
}

export function createPlatformQueries(client: ApiClient) {
  return {
    /** Every published release (global) — the assignment picker. */
    listReleases: () =>
      defineInfiniteQuery<ReleasesPage, string>(client, {
        queryKey: platformKeys.releasesList(),
        initialPageParam: "",
        path: (cursor) =>
          appendSearchParams("/v1/platform/releases", {
            status: "published",
            cursor: cursor || undefined,
          }),
        schema: (data) => releasesPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),

    /** Full detail (body + initialInput) of any release by surrogate id — the
     *  GLOBAL platform read (ADR 0067), so the console can inspect a release its
     *  own org is not assigned. Lazy: enable only when a row is expanded. */
    release: (id: string) =>
      defineQuery<ReleaseDetail>(client, {
        queryKey: platformKeys.release(id),
        path: `/v1/platform/releases/${id}`,
        schema: (data) => releaseSchema.parse(data),
      }),

    /** Retire a published release (CORE_SPEC §3 `published`→`retired`, ADR 0067):
     *  it stops being offered for new work but is never deleted (orgs on it keep
     *  configuring; quotes re-derive forever). Idempotent. `releaseId` is the
     *  natural key (path-encoded). */
    retire: () =>
      defineMutation<ReleaseDetail, { releaseId: string }>(client, {
        method: "POST",
        path: ({ releaseId }) => `/v1/platform/releases/${encodeURIComponent(releaseId)}/retire`,
        // All input is in the path; send no body (the endpoint takes no @Body()).
        body: () => undefined,
        schema: (data) => releaseSchema.parse(data),
      }),

    /** Published catalog versions (summaries) — the release editor's catalog-
     *  version picker (ADR 0068 Phase 2). Platform tier so an org-less operator
     *  can read it. Catalog versions are few; the first page suffices. */
    listCatalogVersions: () =>
      defineQuery<CatalogVersionsPage>(client, {
        queryKey: platformKeys.catalogVersionsList(),
        path: "/v1/platform/catalog-versions",
        schema: (data) => catalogVersionsPageSchema.parse(data),
      }),

    /** Full catalog body (materials/sections/components) by surrogate id — the
     *  options behind the editor's catalog-aware part pickers. Lazy: enable only
     *  once a version is selected and resolved to its id. */
    catalogVersion: (id: string) =>
      defineQuery<CatalogVersionDetail>(client, {
        queryKey: platformKeys.catalogVersion(id),
        path: `/v1/platform/catalog-versions/${id}`,
        schema: (data) => catalogVersionSchema.parse(data),
      }),

    /** Every tenant org (vendor-scale, unpaginated). */
    listOrganizations: () =>
      defineQuery<PlatformOrganizations>(client, {
        queryKey: platformKeys.organizationsList(),
        path: "/v1/platform/organizations",
        schema: (data) => platformOrganizationsSchema.parse(data),
      }),

    /** The release keys one org is currently assigned. */
    assignments: (orgId: string) =>
      defineQuery<ReleaseAssignments>(client, {
        queryKey: platformKeys.assignments(orgId),
        path: `/v1/platform/organizations/${orgId}/releases`,
        schema: (data) => releaseAssignmentsSchema.parse(data),
      }),

    assign: () =>
      defineMutation<ReleaseAssignments, AssignVariables>(client, {
        method: "POST",
        path: ({ orgId }) => `/v1/platform/organizations/${orgId}/releases`,
        body: ({ releaseId }) => assignReleaseSchema.parse({ releaseId }),
        schema: (data) => releaseAssignmentsSchema.parse(data),
      }),

    unassign: () =>
      defineMutation<ReleaseAssignments, AssignVariables>(client, {
        method: "DELETE",
        path: ({ orgId, releaseId }) =>
          `/v1/platform/organizations/${orgId}/releases/${encodeURIComponent(releaseId)}`,
        schema: (data) => releaseAssignmentsSchema.parse(data),
      }),

    /** Broadcast a release to every org on an older version of its model (§3
     *  vendor fan-out): one call raises an opt-in upgrade offer for all of them,
     *  never moving a pin. Returns which orgs gained it vs already had it. */
    broadcast: () =>
      defineMutation<BroadcastAssignResult, { releaseId: string }>(client, {
        method: "POST",
        path: ({ releaseId }) => `/v1/platform/releases/${encodeURIComponent(releaseId)}/broadcast`,
        // All input is in the path; send no body (the endpoint takes no @Body()).
        // Without this, defineMutation defaults the body to the variables object.
        body: () => undefined,
        schema: (data) => broadcastAssignResultSchema.parse(data),
      }),
  };
}
