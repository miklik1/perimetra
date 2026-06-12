import { describe, expect, it, vi } from "vitest";

import { type ApiClient } from "../client/create-api-client";
import { keys } from "../keys";
import { createUsersQueries } from "./users";

function makeClient(): ApiClient {
  return { apiFetch: vi.fn().mockResolvedValue([]) };
}

describe("createUsersQueries", () => {
  it("uses the matching query key", () => {
    const users = createUsersQueries(makeClient());
    expect(users.detail("1").queryKey).toEqual(keys.users.detail("1"));
    expect(users.list().queryKey).toEqual(keys.users.list());
  });

  it("queryFn calls apiFetch with the right path and forwards the signal", async () => {
    const client = makeClient();
    const users = createUsersQueries(client);
    const signal = new AbortController().signal;

    await users.detail("1").queryFn!({ signal } as never);

    expect(client.apiFetch).toHaveBeenCalledWith(
      "/users/1",
      expect.objectContaining({ parse: expect.any(Function), signal }),
    );
  });

  it("create() mutationFn POSTs the input to /users", async () => {
    const client = makeClient();
    const users = createUsersQueries(client);

    // TanStack v5's MutationFunction takes a (variables, context) pair; the
    // factory's fn ignores context, so a stub satisfies the direct call here.
    await users.create().mutationFn!({ name: "Ada", email: "a@b.com" }, {} as never);

    expect(client.apiFetch).toHaveBeenCalledWith(
      "/users",
      expect.objectContaining({
        method: "POST",
        body: { name: "Ada", email: "a@b.com" },
        parse: expect.any(Function),
      }),
    );
  });
});
