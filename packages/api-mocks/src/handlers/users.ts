import { createUserSchema, type User } from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import { listMockUsers } from "../fixtures/users";

const TOTAL_PAGED_USERS = 47;

/** Deterministic synthetic users so the paginated demo has enough rows to page. */
function pagedUser(index: number): User {
  const seq = String(index).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${seq}`,
    email: `user${index}@example.com`,
    name: `User ${index}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Users mock routes (ADR 0018). Returns the bare contracts the client parses
 * (`userListSchema` / `userSchema`) — no envelope. Lets the whole demo (list,
 * detail, create) run with no backend, and lets the static home page bake mock
 * users at build via the in-process transport.
 */
export const userRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: "/users",
    handler: () => ({ data: listMockUsers() }),
  },
  {
    // Must precede `/users/:id` — otherwise "paged" matches as an `:id`. NOTE:
    // these synthetic rows are demo-only and are NOT individually fetchable via
    // `/users/:id` (that handler searches only the real `listMockUsers` fixtures).
    method: "GET",
    pattern: "/users/paged",
    handler: ({ searchParams }) => {
      const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
      const perPage = Math.max(1, Number(searchParams.get("perPage") ?? "10") || 10);
      const start = (page - 1) * perPage;
      const data = Array.from({ length: perPage }, (_, i) => start + i + 1)
        .filter((n) => n <= TOTAL_PAGED_USERS)
        .map(pagedUser);
      const nextPage = start + perPage < TOTAL_PAGED_USERS ? page + 1 : null;
      return { data: { data, nextPage } };
    },
  },
  {
    method: "GET",
    pattern: "/users/:id",
    handler: ({ params }) => {
      const user = listMockUsers().find((u) => u.id === params.id);
      if (!user) throw new MockHttpError(404, "NOT_FOUND", "User not found");
      return { data: user };
    },
  },
  {
    method: "POST",
    pattern: "/users",
    handler: async ({ getBody }) => {
      const parsed = createUserSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid input");
      const user: User = {
        id: crypto.randomUUID(),
        ...parsed.data,
        createdAt: new Date().toISOString(),
      };
      return { data: user, status: 201 };
    },
  },
];
