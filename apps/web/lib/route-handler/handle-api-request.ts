import { NextResponse } from "next/server";

import { createMockConfig, runMock, type MockDispatchConfig } from "@repo/api-mocks";
import { env } from "@repo/config/env/web";

import { proxyToBackend } from "./backend-proxy";

/**
 * The single BFF transport (ADR 0018), shared by both runtimes: the browser hits
 * it over HTTP via the `/api/[...path]` route handler, and the RSC/server-side
 * ApiClient calls it IN-PROCESS via an injected terminal `fetch` (see
 * `lib/server-api.ts`) — no HTTP self-hop, so `next build` works with no server
 * up and RSC still sees mocks.
 *
 * When the dev mock is on, a matched route is served server-side; an UNMATCHED
 * request falls through to the real backend (partial mocking — mock some groups,
 * proxy the rest, restoring the ADR-0016 contract). With mocks off, everything
 * proxies to the backend, hiding its origin.
 */
// Tri-state gate: explicit "true"/"false" wins; unset defaults to mocks ON
// only while no real backend is configured — a fresh clone's `pnpm dev` runs
// self-contained on the bundled fixtures (the documented out-of-box behavior)
// instead of proxying the demo host whose shapes fail validation. Never in
// production.
const mocksEnabled =
  env.NODE_ENV !== "production" &&
  (env.NEXT_PUBLIC_ENABLE_MSW === "true" ||
    (env.NEXT_PUBLIC_ENABLE_MSW === undefined && env.API_URL === undefined));

// `cookieLess: false` — the BFF carries the httpOnly refresh cookie, so the mock
// session is resolved strictly by cookie (no cross-user "last login" fallback).
const mockConfig: MockDispatchConfig = createMockConfig({
  selector: env.NEXT_PUBLIC_MSW_MOCKS,
  overrides: { cookieLess: false },
});
// Only forward credential headers (Authorization + Cookie) when a real backend
// origin is explicitly configured. With `API_URL` unset the proxy targets the
// public jsonplaceholder demo host — a third party we must never relay bearer
// tokens or session cookies to. Stripping them here is the secure default: the
// demo still works (its endpoints are public), but credentials never egress to
// an unconfigured/untrusted origin.
const backendConfigured = env.API_URL !== undefined;
const backendBaseUrl = env.API_URL ?? "https://jsonplaceholder.typicode.com";

export async function handleApiRequest(request: Request): Promise<Response> {
  if (mocksEnabled) {
    const mocked = await runMock(request, mockConfig);
    if (mocked) {
      const init = { status: mocked.status, headers: mocked.headers };
      return mocked.body === undefined
        ? new NextResponse(null, init)
        : NextResponse.json(mocked.body, init);
    }
    // No matching mock route → fall through to the real backend (partial mocking).
  }
  return proxyToBackend(request, { backendBaseUrl, forwardCredentials: backendConfigured });
}
