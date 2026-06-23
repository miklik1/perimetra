import { routes, type RouteName } from "./routes";

/**
 * Active-route matching against the registry's path templates (ADR 0022).
 * Platform-agnostic: the `useActiveRoute()` hooks feed their router's pathname
 * into `matchRoute`; nav components call `isActive` for highlighting.
 */

/** Strip query/hash and a trailing slash (but keep bare `/`). */
function normalizePathname(pathname: string): string {
  const bare = pathname.split(/[?#]/, 1)[0]!;
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

/** Compile a `:name`-templated path into a matcher regex. */
function templateToRegex(template: string, exact: boolean): RegExp {
  const pattern = template
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  // Prefix mode also matches deeper paths ("/users" highlights on "/users/42").
  return new RegExp(`^${pattern}${exact ? "$" : "(?:/|$)"}`);
}

// The registry is const-asserted and static, so every matcher (and the
// specificity rank used by matchRoute) compiles ONCE at module load —
// `isActive` runs per nav link per render and must not rebuild regexes.
const MATCHERS = Object.fromEntries(
  (Object.keys(routes) as RouteName[]).map((name) => {
    const template = routes[name].path;
    return [
      name,
      {
        exact: templateToRegex(template, true),
        prefix: templateToRegex(template, false),
        staticSegments: template.split("/").filter((s) => s && !s.startsWith(":")).length,
      },
    ];
  }),
) as Record<RouteName, { exact: RegExp; prefix: RegExp; staticSegments: number }>;

export interface IsActiveOptions {
  /**
   * `true` (default): the pathname must match the template exactly.
   * `false`: prefix match — parents highlight while a child route is open.
   * Note: even in prefix mode the root template `/` matches only bare `/` — the
   * pattern `^/(?:/|$)` requires an immediate `/` or end-of-string after the
   * template, so it does NOT match `/users`.
   */
  exact?: boolean;
}

/**
 * Does `pathname` match the route's registry template (dynamic segments
 * included)? Accepts the route name; pass `{ exact: false }` for section
 * highlighting.
 */
export function isActive(
  pathname: string,
  route: RouteName,
  { exact = true }: IsActiveOptions = {},
): boolean {
  return MATCHERS[route][exact ? "exact" : "prefix"].test(normalizePathname(pathname));
}

/**
 * Resolve a pathname to the route it renders, preferring the most specific
 * template (static segments beat dynamic ones: `/users` → `users`, not a
 * would-be `/:slug`). `null` when nothing in the registry matches.
 */
export function matchRoute(pathname: string): RouteName | null {
  const normalized = normalizePathname(pathname);
  let best: { name: RouteName; staticSegments: number } | null = null;
  for (const name of Object.keys(MATCHERS) as RouteName[]) {
    const matcher = MATCHERS[name];
    if (!matcher.exact.test(normalized)) continue;
    // Primary key: more static segments win. Secondary key: a stable name
    // compare, so two equally-specific templates resolve deterministically
    // instead of depending on `Object.keys` iteration order.
    if (
      !best ||
      matcher.staticSegments > best.staticSegments ||
      (matcher.staticSegments === best.staticSegments && name < best.name)
    ) {
      best = { name, staticSegments: matcher.staticSegments };
    }
  }
  return best?.name ?? null;
}
