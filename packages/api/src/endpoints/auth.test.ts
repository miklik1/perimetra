import { describe, expect, it, vi } from "vitest";

import { type ApiClient } from "../client/create-api-client";
import { keys } from "../keys";
import { createAuthQueries } from "./auth";

function makeClient(): ApiClient {
  return { apiFetch: vi.fn().mockResolvedValue(undefined) };
}

describe("createAuthQueries", () => {
  it("me() uses the matching query key", () => {
    const auth = createAuthQueries(makeClient());
    expect(auth.me().queryKey).toEqual(keys.auth.me());
  });

  it("me() queryFn GETs /me and forwards the signal", async () => {
    const client = makeClient();
    const auth = createAuthQueries(client);
    const signal = new AbortController().signal;

    await auth.me().queryFn!({ signal } as never);

    expect(client.apiFetch).toHaveBeenCalledWith(
      "/v1/me",
      expect.objectContaining({ parse: expect.any(Function), signal }),
    );
  });

  it("login() mutationFn POSTs credentials to /auth/login", async () => {
    const client = makeClient();
    const auth = createAuthQueries(client);

    await auth.login().mutationFn!({ email: "a@b.com", password: "secret" }, {} as never);

    expect(client.apiFetch).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({
        method: "POST",
        body: { email: "a@b.com", password: "secret" },
        parse: expect.any(Function),
      }),
    );
  });
});
