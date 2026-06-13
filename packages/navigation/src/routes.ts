import { z } from "zod";

/**
 * The single, const-asserted route registry both platforms derive typed paths
 * and param shapes from (ADR 0003). Path templates use `:name` placeholders;
 * declare any placeholder in the matching `params` map. Keep `params` keys in
 * sync with the template — `buildPath` substitutes them at runtime and the
 * `ParamsOf<RouteName>` type derives the static shape from the same source.
 *
 * A route may also declare an optional `search` zod schema (ADR 0022): it
 * types `Href`'s `query`, drives `buildPath`'s serialization, and is what
 * `useSearchParams(route)` parses through (coercion + defaults). Search params
 * are user-editable, so every field MUST be `.optional()` or `.default(…)` —
 * parsing falls back instead of throwing.
 */
export const routes = {
  home: { path: "/" },
  users: {
    path: "/users",
    search: z.object({
      page: z.coerce.number().int().positive().default(1),
      sort: z.enum(["name", "date"]).optional(),
    }),
  },
  user: { path: "/users/:id", params: { id: "string" } },
  login: { path: "/login" },
  account: { path: "/account" },
  projects: { path: "/projects" },
  configurator: { path: "/configurator" },
  site: { path: "/site/:projectId", params: { projectId: "string" } },
  // @gen:exports — `pnpm gen route` registers the new route entry here.
} as const;

export type RouteName = keyof typeof routes;
