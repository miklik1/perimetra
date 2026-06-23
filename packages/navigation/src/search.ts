import type { z } from "zod";

import { routes, type RouteName } from "./routes";
import type { SearchOf } from "./types";

/**
 * Search-param parsing for the route registry's `search` schemas (ADR 0022).
 * Platform-agnostic: the `useSearchParams(route)` hooks in `web.tsx` /
 * `native.tsx` normalize their router's raw params and parse here.
 */

/** A route's `search` schema, if declared. */
function searchSchema(route: RouteName): z.ZodType | undefined {
  return (routes[route] as { search?: z.ZodType }).search;
}

/**
 * Normalize a `URLSearchParams` into the plain record zod schemas parse:
 * repeated keys collapse to arrays, single keys to strings.
 */
export function searchParamsToRecord(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : values[0]!;
  }
  return out;
}

/**
 * Parse raw search params through the route's `search` schema (coercion +
 * defaults). NEVER throws — search params are user-editable URL text:
 * an invalid value falls back per key (drop the offending keys, re-apply
 * defaults), so `?page=abc&sort=name` yields `{ page: 1, sort: "name" }`.
 * Routes without a schema parse to `{}`.
 */
export function parseSearchParams<N extends RouteName>(
  route: N,
  raw: Record<string, unknown>,
): SearchOf<N> {
  const schema = searchSchema(route);
  if (!schema) return {} as SearchOf<N>;

  const result = schema.safeParse(raw);
  if (result.success) return result.data as SearchOf<N>;

  // Drop only the invalid keys so valid params survive garbage neighbours.
  // Skip root-level issues (empty path — e.g. an object-level `.refine`): their
  // `path[0]` is `undefined`, which would add the literal key "undefined" to the
  // set and misattribute the failure to no real key. They fall through to the
  // `{}`-baseline retry below, which is the correct handling.
  const invalid = new Set(
    result.error.issues
      .filter((issue) => issue.path.length > 0)
      .map((issue) => String(issue.path[0])),
  );
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([key]) => !invalid.has(key)));
  const retry = schema.safeParse(cleaned);
  if (retry.success) return retry.data as SearchOf<N>;

  // Schema rejects even `{}` — a registry authoring error (search fields must
  // be optional/defaulted, see routes.ts). Degrade to defaults-only-or-empty
  // rather than throwing in render.
  const defaults = schema.safeParse({});
  return (defaults.success ? defaults.data : {}) as SearchOf<N>;
}
