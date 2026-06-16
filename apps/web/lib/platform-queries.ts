import { defineInfiniteQuery, defineMutation, defineQuery } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams } from "@repo/utils";
import {
  assignReleaseSchema,
  platformOrganizationsSchema,
  releaseAssignmentsSchema,
  releasesPageSchema,
  type PlatformOrganizations,
  type ReleaseAssignments,
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
  };
}
