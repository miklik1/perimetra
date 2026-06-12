import { cookies } from "next/headers";

import { createApiClient, createDebugMiddleware, type ApiClient } from "@repo/api";
import { env } from "@repo/config/env/web";

import { handleApiRequest } from "./route-handler/handle-api-request";

/**
 * Server-side API clients for RSC data fetching (e.g. `prefetchQuery`). Like the
 * browser, the server uses the BFF transport — but IN-PROCESS: an injected
 * terminal `fetch` calls `handleApiRequest` directly instead of doing an HTTP
 * self-hop to `/api` (ADR 0018). This means RSC prefetch works at `next build`
 * with no server up, RSC still sees mocks, and there's no app-origin env to
 * configure. The base URL is an internal sentinel used only to form a valid URL
 * whose `pathname` the handler reads.
 *
 * Two variants so a route only pays for what it needs:
 *
 * - `createServerApiClient` forwards the incoming request's cookies (the
 *   httpOnly Better Auth session, design §7.1) on the in-process request, so an
 *   authed RSC can prefetch as the user — the server-to-server equivalent of
 *   the browser's same-origin cookie send (the BFF proxy relays the Cookie
 *   header when a real backend is configured). Reading `cookies()` opts the
 *   route into dynamic rendering — correct for protected routes (`/account`).
 *   Best-effort: a stale/revoked session 401s here and the browser client
 *   refetches after hydration.
 * - `createPublicServerApiClient` reads no cookie, so a public RSC (the home
 *   page's users list) stays statically renderable.
 */
const baseUrl = "http://rsc.internal/api";

const inProcessFetch: typeof fetch = (input, init) =>
  handleApiRequest(new Request(input as RequestInfo, init));

// Dev-only: record server-side (RSC/in-process) requests to the ring buffer the
// `/api/dev/log` route reads (ADR 0018). Tree-shaken out unless the flag is set.
const middleware =
  env.NEXT_PUBLIC_DEBUG_API === "true" ? [createDebugMiddleware({ record: true })] : undefined;

export async function createServerApiClient(): Promise<ApiClient> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const fetchWithCookies: typeof fetch = (input, init) => {
    const request = new Request(input as RequestInfo, init);
    if (cookieHeader) request.headers.set("cookie", cookieHeader);
    return handleApiRequest(request);
  };
  return createApiClient({ baseUrl, fetch: fetchWithCookies, middleware });
}

export function createPublicServerApiClient(): ApiClient {
  return createApiClient({ baseUrl, fetch: inProcessFetch, middleware });
}
