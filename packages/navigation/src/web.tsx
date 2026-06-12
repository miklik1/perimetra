"use client";

import NextLink from "next/link";
import { useSearchParams as useNextSearchParams, usePathname, useRouter } from "next/navigation";
import { useMemo, type ComponentPropsWithoutRef } from "react";

import { matchRoute } from "./active";
import { buildPath } from "./index";
import type { RouteName } from "./routes";
import { parseSearchParams, searchParamsToRecord } from "./search";
import type { Href, SearchOf } from "./types";

// Re-export the platform-agnostic contract so consumers can pull both the
// route registry and the platform wrapper from the single "@repo/navigation"
// entry. Conditional exports (package.json) pick this file for web builds.
export * from "./index";

/**
 * Web `<Link>` — thin wrapper over `next/link`. Accepts the typed `to` from the
 * shared route registry (ADR 0003) instead of a raw `href`; `buildPath` does
 * the substitution. Other props pass through to NextLink unchanged.
 */
type NextLinkProps = ComponentPropsWithoutRef<typeof NextLink>;
type LinkProps = Omit<NextLinkProps, "href"> & { to: Href };

export function Link({ to, ...rest }: LinkProps) {
  return <NextLink href={buildPath(to)} {...rest} />;
}

/**
 * Web `useNavigate` — wraps `next/navigation` `useRouter` so call sites use the
 * same typed `Href` as `<Link>`. Both platforms expose the same surface
 * (push/replace/back); platform-specific extras (e.g. prefetch on web) are not
 * abstracted — drop down to the native router when needed.
 */
export function useNavigate() {
  const router = useRouter();
  return {
    push: (to: Href) => router.push(buildPath(to)),
    replace: (to: Href) => router.replace(buildPath(to)),
    back: () => router.back(),
  };
}

/**
 * Web typed search-params (ADR 0022): wraps `next/navigation`'s
 * `useSearchParams` and parses through the route's `search` schema — coercion
 * + defaults, garbage falls back per key, never throws. Same surface as the
 * native binding.
 *
 * NOTE: Next requires `useSearchParams` consumers to sit under a `<Suspense>`
 * boundary — without one the build errors (or the whole route de-opts to
 * client rendering). Wrap the client component that calls this, not the page.
 */
export function useSearchParams<N extends RouteName>(route: N): SearchOf<N> {
  const raw = useNextSearchParams();
  return useMemo(() => parseSearchParams(route, searchParamsToRecord(raw)), [route, raw]);
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
