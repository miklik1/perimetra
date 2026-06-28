import { afterEach, describe, expect, it, vi } from "vitest";

// Drive the route through a mutable mocked env so each case controls NODE_ENV +
// the debug flag; `@repo/api` is mocked so the route stays hermetic (no real
// ring buffer / package pull-in).
const envState = vi.hoisted(
  () =>
    ({ NODE_ENV: "development", NEXT_PUBLIC_DEBUG_API: "true" }) as {
      NODE_ENV: string;
      NEXT_PUBLIC_DEBUG_API: string | undefined;
    },
);
vi.mock("@repo/config/env/web", () => ({ env: envState }));
vi.mock("@repo/api", () => ({ getApiLog: () => [{ id: 1 }] }));

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

afterEach(() => {
  envState.NODE_ENV = "development";
  envState.NEXT_PUBLIC_DEBUG_API = "true";
});

describe("GET /api/dev/log", () => {
  it("returns the ring buffer in dev when the debug flag is on", async () => {
    const { GET } = await loadRoute();
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [{ id: 1 }] });
  });

  it("404s when the debug flag is off", async () => {
    envState.NEXT_PUBLIC_DEBUG_API = "false";
    const { GET } = await loadRoute();
    expect(GET().status).toBe(404);
  });

  // Security regression: NEXT_PUBLIC_DEBUG_API is build-baked, so a production
  // image built with it "true" must still NOT serve the in-memory log buffer.
  it("fails closed in production even when the debug flag is on", async () => {
    envState.NODE_ENV = "production";
    const { GET } = await loadRoute();
    expect(GET().status).toBe(404);
  });
});
