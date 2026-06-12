import { appendSearchParams, type SearchParamsInput } from "@repo/utils";
import {
  userListSchema,
  userSchema,
  usersPageSchema,
  type CreateUserInput,
  type User,
  type UsersPage,
} from "@repo/validators";

import { defineInfiniteQuery, defineMutation, defineQuery } from "../builders/define-endpoints";
import { type ApiClient } from "../client/create-api-client";
import { keys } from "../keys";

/**
 * Hand-written users endpoint module (no OpenAPI source yet). A factory bound to
 * an `ApiClient` so it carries no transport state of its own — the same factory
 * serves the browser, RN, and the RSC server, each with its own client. Built on
 * the thin `defineQuery`/`defineMutation` builders, which emit plain
 * `queryOptions`/`mutationOptions` (ADR 0007) and thread the signal, the
 * trust-boundary zod `parse`, and search-param serialization. The exported shape
 * mirrors what a future `@hey-api/openapi-ts` codegen would emit, so call sites
 * stay stable across a generator swap.
 */
export function createUsersQueries(client: ApiClient) {
  return {
    list: (filters?: SearchParamsInput) =>
      defineQuery<User[]>(client, {
        queryKey: keys.users.list(filters),
        path: "/users",
        searchParams: filters,
        schema: (data) => userListSchema.parse(data),
      }),
    detail: (id: string) =>
      defineQuery<User>(client, {
        queryKey: keys.users.detail(id),
        path: `/users/${id}`,
        schema: (data) => userSchema.parse(data),
      }),
    // Cursor-paginated list (ADR 0018): `GET /users/paged?page=N`. Consumed with
    // `useInfiniteQuery`; `getNextPageParam` reads the page's `nextPage`.
    listPaged: (perPage = 10) =>
      defineInfiniteQuery<UsersPage>(client, {
        queryKey: keys.users.pages({ perPage }),
        path: (page) => appendSearchParams("/users/paged", { page, perPage }),
        schema: (data) => usersPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextPage,
      }),
    // POST /users. Validates the response against `userSchema` at the trust
    // boundary; the request input is validated by the form (`createUserSchema`,
    // ADR 0009) before it ever reaches here. Invalidation of `keys.users.lists()`
    // is the caller's concern — the factory holds an ApiClient, not a
    // QueryClient — so the component spreads `invalidateKeys` in `onSuccess`.
    create: () =>
      defineMutation<User, CreateUserInput>(client, {
        method: "POST",
        path: "/users",
        schema: (data) => userSchema.parse(data),
      }),
  };
}
