import { type MockRoute } from "./types";

/**
 * Match a `:param` pattern against a concrete path, returning the captured
 * params or `null` on no match. Segment-count must agree; static segments must
 * be equal; `:name` segments capture (URL-decoded).
 */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const seg = patternParts[i]!;
    const value = pathParts[i]!;
    if (seg.startsWith(":")) {
      params[seg.slice(1)] = decodeURIComponent(value);
    } else if (seg !== value) {
      return null;
    }
  }
  return params;
}

/** First route whose method + pattern matches, with its captured params. */
export function findRoute(
  routes: MockRoute[],
  method: string,
  path: string,
): { route: MockRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}
