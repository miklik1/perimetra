import {
  createProjectSchema,
  saveProjectSiteSchema,
  updateProjectSchema,
  type Project,
} from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import {
  deleteProjectFixture,
  findProjectFixture,
  getProjectSiteFixture,
  insertProjectFixture,
  listProjectFixtures,
  recallIdempotentCreate,
  rememberIdempotentCreate,
  saveProjectSiteFixture,
  updateProjectFixture,
} from "../fixtures/projects";

/**
 * Projects mock routes (ADR 0018), matching the /v1/projects reference
 * contract: keyset pagination by id cursor over the `paginated()` envelope
 * (`{ items, nextCursor }`), Idempotency-Key honored on create (201), archive
 * via POST /:id/archive, soft delete via DELETE (204). Mounted under the BFF's
 * `/api` prefix, so the patterns carry the `/v1` segment (unlike the legacy
 * `/users` demo group). Ownership scoping is a no-op here — the mock session
 * is single-tenant; the real API filters by `ownerId`.
 */

function paginate(
  items: Project[],
  searchParams: URLSearchParams,
): { items: Project[]; nextCursor: string | null } {
  const status = searchParams.get("status");
  const sort = searchParams.get("sort") === "createdAt:asc" ? "asc" : "desc";
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const cursor = searchParams.get("cursor");

  // uuidv7 IS creation order, so keyset pagination sorts and cuts by id.
  let rows = status ? items.filter((p) => p.status === status) : items;
  rows = [...rows].sort((a, b) =>
    sort === "asc" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id),
  );
  if (cursor) {
    const index = rows.findIndex((p) => p.id === cursor);
    rows = index >= 0 ? rows.slice(index + 1) : rows;
  }
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;
  return { items: page, nextCursor };
}

export const projectRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: "/v1/projects",
    handler: ({ searchParams }) => ({ data: paginate(listProjectFixtures(), searchParams) }),
  },
  {
    method: "POST",
    pattern: "/v1/projects",
    handler: async ({ headers, getBody }) => {
      const parsed = createProjectSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid input");

      // Idempotency-Key dedupe: the same attempt-chain replays the original
      // result instead of creating a duplicate (the real API's contract).
      const idempotencyKey = headers.get("idempotency-key");
      if (idempotencyKey) {
        const existing = recallIdempotentCreate(idempotencyKey);
        if (existing) return { data: existing, status: 201 };
      }

      const project = insertProjectFixture(parsed.data);
      if (idempotencyKey) rememberIdempotentCreate(idempotencyKey, project);
      return { data: project, status: 201 };
    },
  },
  {
    method: "GET",
    pattern: "/v1/projects/:id",
    handler: ({ params }) => {
      const project = findProjectFixture(params.id ?? "");
      if (!project) throw new MockHttpError(404, "NOT_FOUND", "Project not found");
      return { data: project };
    },
  },
  {
    method: "PATCH",
    pattern: "/v1/projects/:id",
    handler: async ({ params, getBody }) => {
      const parsed = updateProjectSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid input");
      const project = updateProjectFixture(params.id ?? "", parsed.data);
      if (!project) throw new MockHttpError(404, "NOT_FOUND", "Project not found");
      return { data: project };
    },
  },
  {
    // GET /v1/projects/:id/site (step 6.3c / ADR 0054): the project's designed
    // site + roster, or the fresh-project default. Mock parity for the
    // configurator → project hand-off (CAR-13), which reads this before
    // appending an instance, and for the site canvas's own RSC load.
    method: "GET",
    pattern: "/v1/projects/:id/site",
    handler: ({ params }) => {
      const project = findProjectFixture(params.id ?? "");
      if (!project) throw new MockHttpError(404, "NOT_FOUND", "Project not found");
      return { data: getProjectSiteFixture(params.id ?? "") };
    },
  },
  {
    // PUT /v1/projects/:id/site — full-document replace guarded by the
    // optimistic-lock `expectedVersion`; a stale version 409s (mirrors the
    // real API's conditional UPDATE) instead of clobbering a co-member's save.
    method: "PUT",
    pattern: "/v1/projects/:id/site",
    handler: async ({ params, getBody }) => {
      const id = params.id ?? "";
      const project = findProjectFixture(id);
      if (!project) throw new MockHttpError(404, "NOT_FOUND", "Project not found");
      const parsed = saveProjectSiteSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid input");
      const { expectedVersion, ...doc } = parsed.data;
      const result = saveProjectSiteFixture(id, doc, expectedVersion);
      if (result === "conflict") {
        throw new MockHttpError(409, "CONFLICT", "Site was modified since it was loaded");
      }
      return { data: result };
    },
  },
  {
    method: "POST",
    pattern: "/v1/projects/:id/archive",
    handler: ({ params }) => {
      const project = updateProjectFixture(params.id ?? "", { status: "archived" });
      if (!project) throw new MockHttpError(404, "NOT_FOUND", "Project not found");
      return { data: project };
    },
  },
  {
    method: "DELETE",
    pattern: "/v1/projects/:id",
    handler: ({ params }) => {
      if (!deleteProjectFixture(params.id ?? "")) {
        throw new MockHttpError(404, "NOT_FOUND", "Project not found");
      }
      return {};
    },
  },
];
