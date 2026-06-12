import { http, HttpResponse, type RequestHandler } from "msw";

import { executeRoute } from "./core/dispatch";
import { type MockMethod, type MockRoute } from "./core/types";

/**
 * MSW adapter: turn framework-agnostic `MockRoute[]` into MSW handlers for the
 * client/Node runtimes that can't host the Next BFF — Expo dev and Vitest. Each
 * route registers an origin-agnostic pattern (`*${pattern}`) so it matches
 * whatever base URL the client uses; unmatched requests stay UNHANDLED (no
 * catch-all), so MSW's `onUnhandledRequest` still governs them — partial mocking
 * in dev, strict failure in tests.
 */
const METHODS: Record<MockMethod, typeof http.get> = {
  GET: http.get,
  POST: http.post,
  PUT: http.put,
  PATCH: http.patch,
  DELETE: http.delete,
};

export function createMswHandlers(routes: MockRoute[]): RequestHandler[] {
  return routes.map((route) =>
    METHODS[route.method](`*${route.pattern}`, async ({ request, params }) => {
      const flatParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(params)) {
        flatParams[key] = Array.isArray(value) ? (value[0] ?? "") : value;
      }
      // cookieLess: true — MSW runtimes (Expo/Vitest) don't carry the refresh
      // cookie, so the mock session falls back to the most-recent login.
      const response = await executeRoute(route, request, flatParams, true);
      const init = { status: response.status, headers: response.headers };
      return response.body === undefined
        ? new HttpResponse(null, init)
        : HttpResponse.json(response.body, init);
    }),
  );
}
