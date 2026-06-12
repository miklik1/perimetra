import { describe, expect, it, vi } from "vitest";

// Force the browser branch of getQueryClient (isServer is fixed at import time).
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, isServer: false };
});

const { getQueryClient, makeQueryClient } = await import("./query-client");

describe("makeQueryClient", () => {
  it("applies the shared query defaults", () => {
    const queries = makeQueryClient().getDefaultOptions().queries;
    expect(queries?.staleTime).toBe(60_000);
    expect(queries?.gcTime).toBe(10 * 60_000);
    expect(queries?.retry).toBe(1);
  });

  it("fires the onError hook when a query error surfaces (ADR 0021 DI seam)", async () => {
    const onError = vi.fn();
    const client = makeQueryClient({ onError });
    const boom = new Error("fetch failed");

    await expect(
      client.fetchQuery({
        queryKey: ["users", "broken"],
        queryFn: () => Promise.reject(boom),
        retry: false,
      }),
    ).rejects.toThrow("fetch failed");

    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
  });

  it("fires the onError hook for mutation errors too", async () => {
    const onError = vi.fn();
    const client = makeQueryClient({ onError });
    const boom = new Error("save failed");
    const { MutationObserver } = await import("@tanstack/react-query");
    const observer = new MutationObserver(client, { mutationFn: () => Promise.reject(boom) });

    await expect(observer.mutate()).rejects.toThrow("save failed");

    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
  });
});

describe("getQueryClient (browser path)", () => {
  it("returns a stable singleton in the browser", () => {
    const first = getQueryClient();
    const second = getQueryClient();
    expect(first).toBe(second);
  });
});
