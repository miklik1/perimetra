import type { z } from "zod";

import type { RouteName, routes } from "./routes";

/**
 * Param-spec primitives a registry entry may declare. Extend (add `"boolean"`
 * etc.) only by also widening `ParamValue` below.
 */
type ParamKind = "string" | "number";
type ParamSpec = Record<string, ParamKind>;
type ParamValue<K extends ParamKind> = K extends "string" ? string : number;
type ParamsFromSpec<S extends ParamSpec> = { [K in keyof S]: ParamValue<S[K]> };

/**
 * `ParamsOf<"user">` → `{ id: string }`; `ParamsOf<"home">` →
 * `Record<string, never>` (no params).
 */
export type ParamsOf<N extends RouteName> = (typeof routes)[N] extends {
  params: infer P;
}
  ? P extends ParamSpec
    ? ParamsFromSpec<P>
    : never
  : Record<string, never>;

/**
 * Parsed search-param shape for a route with a `search` schema (ADR 0022) —
 * the schema's OUTPUT type, i.e. after coercion and defaults
 * (`SearchOf<"users">` → `{ page: number; sort?: "name" | "date" }`).
 * `never` for routes without one.
 */
export type SearchOf<N extends RouteName> = (typeof routes)[N] extends {
  search: infer S extends z.ZodType;
}
  ? z.infer<S>
  : never;

// Per-route fragments intersected into `Href`. `unknown` is the intersection
// identity, so routes without the feature contribute nothing — and the object
// literal's excess-property check still rejects a stray `params`/`query` on
// them (the `route` discriminant narrows to the single member first).
type HrefParams<N extends RouteName> = (typeof routes)[N] extends { params: infer P }
  ? P extends ParamSpec
    ? { params: ParamsFromSpec<P> }
    : never
  : unknown;

type HrefQuery<N extends RouteName> = (typeof routes)[N] extends { search: z.ZodType }
  ? {
      /**
       * Typed query for `buildPath` serialization. Partial of the schema
       * output: omitted keys simply don't appear in the URL (the reading side
       * re-applies defaults), so links don't have to spell out `page: 1`.
       */
      query?: Partial<SearchOf<N>>;
    }
  : unknown;

/**
 * Typed link target. Routes without params accept `{ route }`; routes with
 * params require `{ route, params }` matching the registry spec; routes with a
 * `search` schema additionally accept an optional typed `query` (ADR 0022).
 * Discriminated on the registry shape (presence of `params`/`search` on the
 * const-asserted entry). The wrappers in `web.tsx` / `native.tsx` accept this
 * shape and feed it to `buildPath`.
 */
export type Href = {
  [N in RouteName]: { route: N } & HrefParams<N> & HrefQuery<N>;
}[RouteName];
