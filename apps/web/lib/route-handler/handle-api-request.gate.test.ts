// @vitest-environment node
// (the BFF transport imports next/server; the mock gate is derived at module
// load, so each case stubs env → resetModules → re-imports a fresh handler.)
import { afterEach, describe, expect, it, vi } from "vitest";

// Isolate the tier GATE from the real mock fixtures + the network: a stub mock
// dispatcher returns a recognizable body, and the proxy returns a recognizable
// sentinel. Which one answers a request is exactly what `mocksEnabled` decides.
vi.mock("./backend-proxy", () => ({
  proxyToBackend: vi.fn(async () => new Response("PROXIED", { status: 200 })),
}));
vi.mock("@repo/api-mocks", () => ({
  createMockConfig: vi.fn(() => ({})),
  runMock: vi.fn(async () => ({ status: 200, headers: {}, body: { mocked: true } })),
}));

async function loadHandler(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.resetModules();
  return (await import("./handle-api-request")).handleApiRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

const request = () => new Request("http://localhost/api/v1/users");

describe("handle-api-request mock gate keys off TIER, not NODE_ENV", () => {
  it("keeps mocks ON for a Vercel PREVIEW deploy despite NODE_ENV=production (the bug this fixes)", async () => {
    // Vercel sets NODE_ENV=production on preview too; the pre-fix NODE_ENV gate
    // silently proxied here. The tier gate keeps the mock serving.
    const handleApiRequest = await loadHandler({
      VERCEL_TARGET_ENV: "preview",
      NODE_ENV: "production",
      NEXT_PUBLIC_ENABLE_MSW: "true",
    });
    const res = await handleApiRequest(request());
    await expect(res.json()).resolves.toEqual({ mocked: true });
  });

  it("keeps mocks OFF on the prod tier even with NEXT_PUBLIC_ENABLE_MSW=true (no mock-leak to prod)", async () => {
    const handleApiRequest = await loadHandler({
      VERCEL_TARGET_ENV: "production",
      NODE_ENV: "production",
      NEXT_PUBLIC_ENABLE_MSW: "true",
      API_URL: "https://api.example.com",
    });
    const res = await handleApiRequest(request());
    await expect(res.text()).resolves.toBe("PROXIED");
  });
});
