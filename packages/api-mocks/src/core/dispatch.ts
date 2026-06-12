import { dispatchMockError, errorEnvelope } from "./response-envelope";
import { findRoute } from "./router";
import { type MockResponse, type MockRoute } from "./types";

export interface MockDispatchConfig {
  routes: MockRoute[];
  /** Path prefix to strip before matching (the BFF mounts mocks under `/api`). */
  prefix?: string;
  /** `[min, max]` artificial latency in ms — exercises loading/race states. */
  delayRange?: [number, number];
  /**
   * Whether this runtime lacks the refresh cookie (Expo/Vitest MSW). When true,
   * the mock session may fall back to "most recent login"; the BFF leaves it
   * false so sessions resolve strictly by cookie (no cross-user bleed).
   */
  cookieLess?: boolean;
}

/**
 * Strip a mount prefix from a pathname, guarding on the `/` boundary so a
 * prefix-adjacent path (e.g. `/apidocs` under prefix `/api`) is left intact.
 * Shared by the dispatcher and the backend proxy so both normalize identically.
 */
export function stripApiPrefix(pathname: string, prefix?: string): string {
  if (!prefix) return pathname || "/";
  if (pathname === prefix) return "/";
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

async function maybeDelay(range?: [number, number]): Promise<void> {
  if (!range) return;
  const [min, max] = range;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single matched route against a standard `Request` and normalize the
 * outcome. Shared by the BFF dispatcher and the MSW adapter so both behave
 * identically (status defaulting, error envelopes, body parsing).
 */
export async function executeRoute(
  route: MockRoute,
  request: Request,
  params: Record<string, string>,
  cookieLess = false,
): Promise<MockResponse> {
  const url = new URL(request.url);
  try {
    const result = await route.handler({
      method: route.method,
      path: url.pathname,
      params,
      searchParams: url.searchParams,
      headers: request.headers,
      cookieLess,
      getBody: async () => {
        try {
          return await request.clone().json();
        } catch {
          return undefined;
        }
      },
    });
    const status = result.status ?? (result.data === undefined ? 204 : 200);
    return { status, body: result.data, headers: result.headers ?? {} };
  } catch (error) {
    return dispatchMockError(error);
  }
}

/**
 * Match + run a request against the config's routes. Returns `null` when no
 * route matches, so the caller decides between a `404` (BFF) and passthrough to
 * the real network (MSW partial-mocking). Applies the configured latency.
 */
export async function runMock(
  request: Request,
  config: MockDispatchConfig,
): Promise<MockResponse | null> {
  const url = new URL(request.url);
  const path = stripApiPrefix(url.pathname, config.prefix);
  const match = findRoute(config.routes, request.method.toUpperCase(), path);
  if (!match) return null;
  await maybeDelay(config.delayRange);
  return executeRoute(match.route, request, match.params, config.cookieLess ?? false);
}

/**
 * Server-side entry for the BFF route handler: a matched route's response, or a
 * `404` envelope when nothing matches (the BFF owns the whole `/api` surface, so
 * an unmatched path is a genuine not-found, not a passthrough).
 */
export async function resolveMock(
  request: Request,
  config: MockDispatchConfig,
): Promise<MockResponse> {
  const result = await runMock(request, config);
  if (result) return result;
  const url = new URL(request.url);
  return {
    status: 404,
    body: errorEnvelope("NOT_FOUND", `No mock for ${request.method} ${url.pathname}`),
    headers: {},
  };
}
