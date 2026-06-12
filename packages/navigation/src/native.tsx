import { Link as ExpoLink, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useMemo, type ComponentProps } from "react";

import { matchRoute } from "./active";
import { buildPath } from "./index";
import type { RouteName } from "./routes";
import { parseSearchParams } from "./search";
import type { Href, SearchOf } from "./types";

// Re-export the platform-agnostic contract so consumers can pull both the
// route registry and the platform wrapper from the single "@repo/navigation"
// entry. Conditional exports (package.json) pick this file under Metro's
// `react-native` resolver condition.
export * from "./index";

/**
 * Mobile `<Link>` — thin wrapper over expo-router's `<Link>`. `to` is the
 * typed shared-registry shape; `buildPath` produces the concrete URL that
 * expo-router accepts. `href` is cast to `never` because expo-router's
 * `Href` type is a typed-routes literal union over the app's route tree —
 * which only it knows — while ours is the registry's literal union. Both
 * end up as the same string at runtime.
 */
type ExpoLinkProps = ComponentProps<typeof ExpoLink>;
type LinkProps = Omit<ExpoLinkProps, "href"> & { to: Href };

export function Link({ to, ...rest }: LinkProps) {
  return <ExpoLink href={buildPath(to) as never} {...rest} />;
}

/**
 * Mobile `useNavigate` — wraps `expo-router` `useRouter`. Same surface as the
 * web wrapper so call sites stay platform-agnostic.
 */
export function useNavigate() {
  const router = useRouter();
  return {
    push: (to: Href) => router.push(buildPath(to) as never),
    replace: (to: Href) => router.replace(buildPath(to) as never),
    back: () => router.back(),
  };
}

/**
 * Mobile typed search-params (ADR 0022): wraps expo-router's
 * `useLocalSearchParams` (already a string/string[] record) and parses through
 * the route's `search` schema — coercion + defaults, garbage falls back per
 * key, never throws. Same surface as the web binding.
 */
export function useSearchParams<N extends RouteName>(route: N): SearchOf<N> {
  const raw = useLocalSearchParams();
  return useMemo(() => parseSearchParams(route, raw), [route, raw]);
}

/**
 * The registry route the current pathname renders (most-specific template
 * wins), or `null` outside the registry. Pair with `isActive` for nav
 * highlighting.
 */
export function useActiveRoute(): RouteName | null {
  const pathname = usePathname();
  return useMemo(() => matchRoute(pathname), [pathname]);
}

export { usePathname };
