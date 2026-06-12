import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";

import { createToastApi, createToastStore, DEFAULT_MAX_VISIBLE, type ToastState } from "./toast";

const ids = (store: StoreApi<ToastState>) => store.getState().toasts.map((t) => t.id);

describe("createToastStore", () => {
  it("starts empty", () => {
    expect(createToastStore().getState().toasts).toEqual([]);
  });

  it("add enqueues a toast and returns its id", () => {
    const store = createToastStore();
    const id = store.getState().add({ type: "info", message: "hi" });
    expect(id).toBe("0");
    expect(store.getState().toasts).toEqual([{ id: "0", type: "info", message: "hi" }]);
  });

  it("assigns unique, deterministic counter ids", () => {
    const store = createToastStore();
    expect(store.getState().add({ type: "info", message: "a" })).toBe("0");
    expect(store.getState().add({ type: "info", message: "b" })).toBe("1");
    expect(store.getState().add({ type: "info", message: "c" })).toBe("2");
    expect(ids(store)).toEqual(["0", "1", "2"]);
  });

  it("does not reuse a counter id after a dismiss", () => {
    const store = createToastStore();
    const first = store.getState().add({ type: "info", message: "a" });
    store.getState().dismiss(first);
    expect(store.getState().add({ type: "info", message: "b" })).toBe("1");
  });

  it("dedups by key: a second add updates the existing toast in place", () => {
    const store = createToastStore();
    const id = store.getState().add({ type: "info", message: "saving", key: "save" });
    const again = store.getState().add({ type: "success", message: "saved", key: "save" });
    expect(again).toBe(id);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0]).toEqual({
      id,
      type: "success",
      message: "saved",
      key: "save",
    });
  });

  it("keeps the slot/order when a keyed toast is coalesced", () => {
    const store = createToastStore();
    store.getState().add({ type: "info", message: "a", key: "k" });
    store.getState().add({ type: "info", message: "b" });
    store.getState().add({ type: "success", message: "a2", key: "k" });
    expect(ids(store)).toEqual(["0", "1"]);
    expect(store.getState().toasts[0]?.message).toBe("a2");
  });

  it("treats keyless toasts as always distinct", () => {
    const store = createToastStore();
    store.getState().add({ type: "info", message: "dup" });
    store.getState().add({ type: "info", message: "dup" });
    expect(store.getState().toasts).toHaveLength(2);
  });

  it("update patches a toast by id", () => {
    const store = createToastStore();
    const id = store.getState().add({ type: "info", message: "old" });
    store.getState().update(id, { message: "new", type: "success" });
    expect(store.getState().toasts[0]).toMatchObject({ id, message: "new", type: "success" });
  });

  it("update is a no-op for an unknown / dismissed id", () => {
    const store = createToastStore();
    const id = store.getState().add({ type: "info", message: "x" });
    store.getState().dismiss(id);
    store.getState().update(id, { message: "ghost" });
    expect(store.getState().toasts).toEqual([]);
  });

  it("dismiss removes only the matching toast", () => {
    const store = createToastStore();
    const a = store.getState().add({ type: "info", message: "a" });
    const b = store.getState().add({ type: "info", message: "b" });
    store.getState().dismiss(a);
    expect(ids(store)).toEqual([b]);
  });

  it("dismiss is a no-op for an unknown id", () => {
    const store = createToastStore();
    store.getState().add({ type: "info", message: "a" });
    store.getState().dismiss("999");
    expect(store.getState().toasts).toHaveLength(1);
  });

  it("clear drops everything", () => {
    const store = createToastStore();
    store.getState().add({ type: "info", message: "a" });
    store.getState().add({ type: "info", message: "b" });
    store.getState().clear();
    expect(store.getState().toasts).toEqual([]);
  });

  describe("visible / maxVisible", () => {
    it("defaults to DEFAULT_MAX_VISIBLE and keeps overflow queued", () => {
      const store = createToastStore();
      for (let i = 0; i < DEFAULT_MAX_VISIBLE + 2; i++) {
        store.getState().add({ type: "info", message: `m${i}` });
      }
      expect(store.getState().toasts).toHaveLength(DEFAULT_MAX_VISIBLE + 2);
      expect(store.getState().visible()).toHaveLength(DEFAULT_MAX_VISIBLE);
      expect(
        store
          .getState()
          .visible()
          .map((t) => t.message),
      ).toEqual(["m0", "m1", "m2"]);
    });

    it("honours a custom maxVisible", () => {
      const store = createToastStore({ maxVisible: 1 });
      store.getState().add({ type: "info", message: "a" });
      store.getState().add({ type: "info", message: "b" });
      expect(
        store
          .getState()
          .visible()
          .map((t) => t.message),
      ).toEqual(["a"]);
    });

    it("promotes overflow once a visible toast is dismissed", () => {
      const store = createToastStore({ maxVisible: 1 });
      const a = store.getState().add({ type: "info", message: "a" });
      store.getState().add({ type: "info", message: "b" });
      expect(
        store
          .getState()
          .visible()
          .map((t) => t.message),
      ).toEqual(["a"]);
      store.getState().dismiss(a);
      expect(
        store
          .getState()
          .visible()
          .map((t) => t.message),
      ).toEqual(["b"]);
    });
  });
});

describe("createToastApi", () => {
  it("type helpers set the variant and message", () => {
    const store = createToastStore();
    const toast = createToastApi(store);
    toast.success("ok");
    toast.error("bad");
    toast.info("fyi");
    toast.warning("careful");
    expect(store.getState().toasts.map((t) => [t.type, t.message])).toEqual([
      ["success", "ok"],
      ["error", "bad"],
      ["info", "fyi"],
      ["warning", "careful"],
    ]);
  });

  it("type helpers forward opts (title/duration/key/action) and return the id", () => {
    const store = createToastStore();
    const toast = createToastApi(store);
    const onAction = vi.fn();
    const id = toast.error("nope", {
      title: "Error",
      duration: 8000,
      key: "save",
      action: { label: "Retry", onAction },
    });
    expect(store.getState().toasts[0]).toEqual({
      id,
      type: "error",
      message: "nope",
      title: "Error",
      duration: 8000,
      key: "save",
      action: { label: "Retry", onAction },
    });
  });

  it("dismiss delegates to the store", () => {
    const store = createToastStore();
    const toast = createToastApi(store);
    const id = toast.info("x");
    toast.dismiss(id);
    expect(store.getState().toasts).toEqual([]);
  });

  describe("promise", () => {
    it("adds a sticky loading toast then transitions to success", async () => {
      const store = createToastStore();
      const toast = createToastApi(store);
      const result = toast.promise(Promise.resolve(42), {
        loading: "Saving…",
        success: (v) => `Saved ${v}`,
        error: "Failed",
      });
      // Sticky loading toast present synchronously, no auto-dismiss.
      expect(store.getState().toasts[0]).toMatchObject({
        type: "info",
        message: "Saving…",
        duration: 0,
      });
      await expect(result).resolves.toBe(42);
      expect(store.getState().toasts).toHaveLength(1);
      expect(store.getState().toasts[0]).toMatchObject({
        type: "success",
        message: "Saved 42",
        duration: undefined,
      });
    });

    it("transitions to error and re-throws on rejection", async () => {
      const store = createToastStore();
      const toast = createToastApi(store);
      const boom = new Error("boom");
      const result = toast.promise(Promise.reject(boom), {
        loading: "Working…",
        success: "Done",
        error: (e) => `Failed: ${(e as Error).message}`,
      });
      await expect(result).rejects.toBe(boom);
      expect(store.getState().toasts).toHaveLength(1);
      expect(store.getState().toasts[0]).toMatchObject({
        type: "error",
        message: "Failed: boom",
      });
    });

    it("accepts plain string success/error messages", async () => {
      const store = createToastStore();
      const toast = createToastApi(store);
      await toast.promise(Promise.resolve("v"), {
        loading: "L",
        success: "S",
        error: "E",
      });
      expect(store.getState().toasts[0]).toMatchObject({ type: "success", message: "S" });
    });
  });
});
