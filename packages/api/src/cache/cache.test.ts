import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { invalidateKeys } from "./invalidation";
import { optimisticUpdate } from "./optimistic";

describe("invalidateKeys", () => {
  it("invalidates every key passed", async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    await invalidateKeys(queryClient, [
      ["users", "list"],
      ["users", "detail", "1"],
    ]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["users", "list"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["users", "detail", "1"] });
  });
});

describe("optimisticUpdate", () => {
  const key = ["users", "detail", "1"];

  it("applies the update on mutate and snapshots the previous value", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, { id: "1", name: "old" });

    const handlers = optimisticUpdate<{ id: string; name: string }, { name: string }>({
      queryClient,
      key,
      update: (current, vars) => ({ ...current!, ...vars }),
    });

    const context = await handlers.onMutate({ name: "new" });
    expect(queryClient.getQueryData(key)).toEqual({ id: "1", name: "new" });
    expect(context.previous).toEqual({ id: "1", name: "old" });
  });

  it("rolls back to the snapshot on error", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, { id: "1", name: "old" });

    const handlers = optimisticUpdate<{ id: string; name: string }, { name: string }>({
      queryClient,
      key,
      update: (current, vars) => ({ ...current!, ...vars }),
    });

    const context = await handlers.onMutate({ name: "new" });
    handlers.onError(new Error("boom"), { name: "new" }, context);

    expect(queryClient.getQueryData(key)).toEqual({ id: "1", name: "old" });
  });

  it("revalidates the key on settle", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    const handlers = optimisticUpdate<unknown, unknown>({ queryClient, key, update: () => ({}) });
    handlers.onSettled();

    expect(spy).toHaveBeenCalledWith({ queryKey: key });
  });
});
