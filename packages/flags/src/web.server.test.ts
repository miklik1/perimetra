import type { PostHog as PostHogNode } from "posthog-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FLAGS } from "./registry";
import {
  configureServerFlags,
  getAllFlags,
  getBootstrap,
  getFlag,
  resetServerFlags,
  type ServerFlagsIdentity,
} from "./web.server";

const fakeServerClient = (flags: Record<string, boolean | string>) =>
  ({ getAllFlags: vi.fn().mockResolvedValue(flags) }) as unknown as PostHogNode;

const anon = (distinctId: string): ServerFlagsIdentity => ({ distinctId, isIdentified: false });

afterEach(() => {
  resetServerFlags();
});

// NOTE: React's `cache()` only memoizes inside an RSC request render — in
// this node/jsdom test runtime it is a passthrough, so per-call coherence is
// what these tests can assert (one evaluation feeding identity + flags
// together); the cross-call dedup is exercised in the app at runtime.

describe("server flags before configure", () => {
  it("getFlag/getAllFlags serve registry defaults; getBootstrap is undefined", async () => {
    await expect(getFlag("example-flag")).resolves.toBe(FLAGS["example-flag"].default);
    await expect(getAllFlags()).resolves.toEqual({
      "example-flag": FLAGS["example-flag"].default,
    });
    await expect(getBootstrap()).resolves.toBeUndefined();
  });
});

describe("server flags once configured", () => {
  it("getFlag returns the evaluated value for the resolved identity", async () => {
    const client = fakeServerClient({ "example-flag": false });
    configureServerFlags({ client, getIdentity: () => Promise.resolve(anon("user-1")) });
    await expect(getFlag("example-flag")).resolves.toBe(false);
    expect(client.getAllFlags).toHaveBeenCalledWith("user-1");
  });

  it("getBootstrap couples the evaluated flags with the SAME identity", async () => {
    const client = fakeServerClient({ "example-flag": false, "not-in-registry": "v2" });
    const getIdentity = vi
      .fn<() => Promise<ServerFlagsIdentity>>()
      .mockResolvedValue({ distinctId: "user-7", isIdentified: true });
    configureServerFlags({ client, getIdentity });
    const bootstrap = await getBootstrap();
    expect(bootstrap).toEqual({
      distinctID: "user-7",
      isIdentifiedID: true,
      featureFlags: { "example-flag": false, "not-in-registry": "v2" },
    });
    // One evaluation produced both fields — the id cannot diverge from the
    // flags it evaluated (the first-visit minted-UUID coherence guarantee).
    expect(getIdentity).toHaveBeenCalledTimes(1);
    expect(client.getAllFlags).toHaveBeenCalledTimes(1);
  });

  it("getAllFlags overlays evaluated values on defaults, registry keys only", async () => {
    configureServerFlags({
      client: fakeServerClient({ "not-in-registry": true }),
      getIdentity: () => Promise.resolve(anon("user-1")),
    });
    await expect(getAllFlags()).resolves.toEqual({
      "example-flag": FLAGS["example-flag"].default,
    });
  });

  it("degrades to registry defaults when evaluation throws", async () => {
    const client = {
      getAllFlags: vi.fn().mockRejectedValue(new Error("posthog down")),
    } as unknown as PostHogNode;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    configureServerFlags({ client, getIdentity: () => Promise.resolve(anon("user-1")) });
    await expect(getFlag("example-flag")).resolves.toBe(FLAGS["example-flag"].default);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is idempotent — the first configure wins", async () => {
    const first = fakeServerClient({ "example-flag": false });
    configureServerFlags({ client: first, getIdentity: () => Promise.resolve(anon("a")) });
    configureServerFlags({
      client: fakeServerClient({ "example-flag": true }),
      getIdentity: () => Promise.resolve(anon("b")),
    });
    await expect(getFlag("example-flag")).resolves.toBe(false);
    expect(first.getAllFlags).toHaveBeenCalledWith("a");
  });
});
