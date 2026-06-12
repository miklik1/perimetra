import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../client/create-api-client";
import { defineInfiniteQuery, defineMutation, defineQuery } from "./define-endpoints";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const client = () => createApiClient({ baseUrl: "https://api.test" });

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("defineQuery", () => {
  it("serializes searchParams, threads the signal, and validates the body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1 }]));
    const options = defineQuery<{ id: number }[]>(client(), {
      queryKey: ["users", "list"],
      path: "/users",
      searchParams: { page: 2, q: "a" },
      schema: (d) => d as { id: number }[],
      staleTime: 5000,
    });

    expect(options.queryKey).toEqual(["users", "list"]);
    expect(options.staleTime).toBe(5000);

    const controller = new AbortController();
    const result = await options.queryFn!({ signal: controller.signal } as never);
    expect(result).toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/users?page=2&q=a");
    expect(init.signal).toBe(controller.signal);
  });
});

describe("defineMutation", () => {
  it("derives the path from variables and sends the body by default", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const options = defineMutation<{ ok: boolean }, { id: string; name: string }>(client(), {
      method: "PATCH",
      path: (vars) => `/users/${vars.id}`,
      schema: (d) => d as { ok: boolean },
    });

    const result = await options.mutationFn!({ id: "7", name: "Ada" }, {} as never);
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/users/7");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ id: "7", name: "Ada" }));
  });
});

describe("defineInfiniteQuery", () => {
  it("fetches a page by param and derives the next page param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }], nextPage: 2 }));
    const options = defineInfiniteQuery<{ data: { id: number }[]; nextPage: number | null }>(
      client(),
      {
        queryKey: ["users", "pages"],
        path: (page) => `/users/paged?page=${page}`,
        getNextPageParam: (last) => last.nextPage,
      },
    );

    expect(options.initialPageParam).toBe(1);
    const page = await options.queryFn!({
      pageParam: 1,
      signal: new AbortController().signal,
    } as never);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/users/paged?page=1");
    expect(options.getNextPageParam(page as never, [], 1 as never, [] as never)).toBe(2);
    expect(
      options.getNextPageParam({ data: [], nextPage: null } as never, [], 5 as never, [] as never),
    ).toBeUndefined(); // null → stop
  });
});
