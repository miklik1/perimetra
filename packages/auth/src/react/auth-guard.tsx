"use client";

import { useEffect, type ReactNode } from "react";

import { useAuth } from "./use-auth";

export interface AuthGuardProps {
  children: ReactNode;
  /**
   * Invoked once the session resolves unauthenticated. Kept as a callback so
   * the guard stays router-agnostic — web passes a `next/navigation` push, a
   * future mobile guard passes an expo-router navigation.
   */
  redirect: () => void;
  /** Rendered while the session is resolving and during a redirect. */
  fallback?: ReactNode;
}

/**
 * Gates a subtree behind authentication. `useSession` resolves the cookie
 * session once on mount; `children` render as soon as a user is present and
 * `fallback` covers the initial fetch plus the redirect that fires when the
 * session resolves unauthenticated. The request-time gate (apps/web/proxy.ts)
 * already bounces cookie-less visitors before the page renders, so on web the
 * fallback is only seen with a stale/revoked cookie.
 *
 * **The SSR seam (ADR 0135).** Better Auth's session store cannot resolve on
 * the server, so without a hint this guard painted its `fallback` into EVERY
 * server render — the real page only ever existed after hydration, and the
 * RSC prefetch each protected page does bought a cache hit but never a first
 * paint. `initiallyAuthenticated` (seeded on `<AuthProvider>` from the
 * request's session-cookie PRESENCE) closes that: while the session is still
 * in flight the guard renders `children` optimistically instead.
 *
 * The redirect effect below is deliberately UNCHANGED — it still fires only on
 * a CONFIRMED `sessionValidated && !isAuthenticated`. So a stale or revoked
 * cookie still bounces; it just paints the page shell for the one client tick
 * between hydration and the session answer. That is not a leak: the seed
 * carries no user data, the server rendered no authenticated payload (the RSC
 * prefetch 401s and every page is written to survive an empty bundle), and
 * every subsequent data call 401s against the API, which stays the authority.
 */
export function AuthGuard({ children, redirect, fallback = null }: AuthGuardProps) {
  const { isAuthenticated, sessionValidated, initiallyAuthenticated } = useAuth();

  useEffect(() => {
    if (sessionValidated && !isAuthenticated) redirect();
  }, [sessionValidated, isAuthenticated, redirect]);

  // MUST stay identical to the `framed` computation in the host app's shell
  // (apps/web/components/app-shell/app-shell.tsx) — the two flip together by
  // design, and a divergence reintroduces the layout shift on auth-resolve that
  // the joint flip exists to prevent. It is duplicated rather than shared
  // because the shell's test suite module-mocks `@repo/auth/react` down to
  // `useAuth` alone, so a second imported symbol would be undefined there.
  if (isAuthenticated || (!sessionValidated && initiallyAuthenticated)) return <>{children}</>;
  return <>{fallback}</>;
}
