import { defineInfiniteQuery, defineMutation, mutationOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams, stableParams, type SearchParamsInput } from "@repo/utils";
import {
  createProjectSchema,
  projectSchema,
  projectSiteSchema,
  projectsPageSchema,
  saveProjectSiteSchema,
  type CreateProjectInput,
  type Project,
  type ProjectSite,
  type ProjectsPage,
  type SaveProjectSiteInput,
} from "@repo/validators";

/**
 * Projects endpoint factory + key tier, same shape as `createUsersQueries`
 * (ADR 0007): bound to an `ApiClient`, emitting plain `queryOptions` /
 * `mutationOptions` via the thin builders. Lives app-side (not in `@repo/api`)
 * because this is the example-resource consumption layer; promote it into
 * `packages/api/src/endpoints/projects.ts` (+ `keys.ts`) when the resource
 * graduates from example to product surface.
 *
 * Transport: the `/v1/projects` path rides the same-origin proxy — with a real
 * backend the `/api/v1/*` rewrite hits the API service directly; in mock mode
 * the BFF route handler serves the `projects` mock group (ADR 0018).
 */

/** The `InfiniteData` shape TanStack caches for the list — used by optimistic updates. */
export interface ProjectsPages {
  pages: ProjectsPage[];
  pageParams: unknown[];
}

/** Hierarchical key tier, mirroring `keys.users` in `@repo/api`. */
export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  list: (filters?: SearchParamsInput) => [...projectKeys.lists(), stableParams(filters)] as const,
} as const;

// A type alias (not an interface) so it picks up the implicit index signature
// `SearchParamsInput` requires (interfaces don't).
export type ListProjectsFilters = {
  /** Page size (server default 20, max 100). */
  limit?: number;
  /** `createdAt:asc` | `createdAt:desc` (server default desc). */
  sort?: "createdAt:asc" | "createdAt:desc";
  status?: "active" | "archived";
};

export interface CreateProjectVariables {
  input: CreateProjectInput;
  /**
   * One `crypto.randomUUID()` per submission attempt-chain: minted in the
   * submit handler, constant across the transport retries of that attempt
   * (the retry middleware re-dispatches the same request/headers), so the
   * server's Idempotency-Key dedupe collapses them into one create.
   */
  idempotencyKey: string;
}

export interface SaveProjectSiteVariables {
  projectId: string;
  input: SaveProjectSiteInput;
}

export function createProjectsQueries(client: ApiClient) {
  return {
    // GET /v1/projects — keyset pagination by id cursor (uuidv7 IS creation
    // order). The page param is the cursor; "" means "first page" (the builder
    // treats a `null` initialPageParam as unset, so the empty-string sentinel
    // stands in — it serializes to no `cursor` param at all). `getNextPageParam`
    // returns the envelope's `nextCursor`; `null` stops paging.
    list: (filters?: ListProjectsFilters) =>
      defineInfiniteQuery<ProjectsPage, string>(client, {
        queryKey: projectKeys.list(filters),
        initialPageParam: "",
        path: (cursor) =>
          appendSearchParams("/v1/projects", { ...filters, cursor: cursor || undefined }),
        schema: (data) => projectsPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),
    // POST /v1/projects (201) — built on `apiFetch` directly (not
    // `defineMutation`) because the Idempotency-Key header is per-call state
    // the builder doesn't model; `mutationOptions` keeps it options-not-hooks.
    create: () =>
      mutationOptions({
        mutationFn: ({ input, idempotencyKey }: CreateProjectVariables) =>
          client.apiFetch<Project>("/v1/projects", {
            method: "POST",
            body: createProjectSchema.parse(input),
            headers: { "Idempotency-Key": idempotencyKey },
            parse: (data) => projectSchema.parse(data),
          }),
      }),
    // POST /v1/projects/:id/archive — emits the `project.archived` outbox event
    // server-side; the worker fans it out to `user:<ownerId>` (the LIVE badge).
    archive: () =>
      defineMutation<Project, string>(client, {
        method: "POST",
        path: (id) => `/v1/projects/${id}/archive`,
        body: () => undefined,
        schema: (data) => projectSchema.parse(data),
      }),
    // DELETE /v1/projects/:id — soft delete, 204 No Content.
    remove: () =>
      defineMutation<void, string>(client, {
        method: "DELETE",
        path: (id) => `/v1/projects/${id}`,
        body: () => undefined,
      }),
    // PUT /v1/projects/:id/site — full-document replace of the designed site +
    // roster (step 6.3c). PUT is naturally idempotent (same body → same state),
    // so no Idempotency-Key. The initial load is an RSC fetch (prop-passed into
    // the canvas), so there's no list query to invalidate here.
    saveSite: () =>
      mutationOptions({
        mutationFn: ({ projectId, input }: SaveProjectSiteVariables) =>
          client.apiFetch<ProjectSite>(`/v1/projects/${projectId}/site`, {
            method: "PUT",
            body: saveProjectSiteSchema.parse(input),
            parse: (data) => projectSiteSchema.parse(data),
          }),
      }),
  };
}
