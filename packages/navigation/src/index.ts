import { appendSearchParams, type SearchParamsInput } from "@repo/utils";

import { routes, type RouteName } from "./routes";
import type { Href } from "./types";

/**
 * Pure-TS route contract. Platform-agnostic: imports nothing from React,
 * Next.js, or expo-router. The web/native wrappers (`./web`, `./native`)
 * consume this barrel; apps may also import the registry and types directly
 * to build URLs in non-component code.
 */
export { routes } from "./routes";
export type { RouteName } from "./routes";
export type { Href, ParamsOf, SearchOf } from "./types";
export { parseSearchParams, searchParamsToRecord } from "./search";
export { isActive, matchRoute } from "./active";
export type { IsActiveOptions } from "./active";

/**
 * Substitute `:name` placeholders in the registry's path template with values
 * from `href.params`, then serialize a typed `query` (ADR 0022) via the shared
 * stable ordering in `@repo/utils` — sorted keys, dropped null/undefined — so
 * route URLs and API cache keys can never disagree on serialization. Returns
 * the concrete URL both platforms feed to their native router. Throws on an
 * unknown route or a missing param — these are unreachable when the call site
 * is type-checked, so the throws are defensive (covers JS callers + drift
 * between registry and types).
 */
export function buildPath(href: Href): string {
  const entry = routes[href.route as RouteName];
  if (!entry) throw new Error(`Unknown route: ${String(href.route)}`);
  let path: string = entry.path;
  if ("params" in href) {
    for (const [key, value] of Object.entries(href.params)) {
      // Boundary-anchored so `:id` can never match INSIDE a longer placeholder
      // like `:idx` (a substring check would silently corrupt the path). Param
      // keys are identifier-shaped by the registry's typed spec, so the key
      // needs no regex-escaping.
      const placeholder = new RegExp(`:${key}(?![A-Za-z0-9_])`);
      if (!placeholder.test(path)) {
        throw new Error(`Route "${href.route}" has no param ":${key}"`);
      }
      // An empty value passes the colon-cleared check below (`/users/:id` →
      // `/users/`) and silently ships a wrong URL. Reject it like a missing
      // param — defensive against JS callers / registry-vs-type drift.
      if (String(value) === "") {
        throw new Error(`Route "${href.route}" param ":${key}" cannot be empty`);
      }
      path = path.replace(placeholder, encodeURIComponent(String(value)));
    }
  }
  if (path.includes(":")) {
    throw new Error(`Unfilled param in path "${path}" for route "${href.route}"`);
  }
  if ("query" in href && href.query) {
    path = appendSearchParams(path, href.query as SearchParamsInput);
  }
  return path;
}
