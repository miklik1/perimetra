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
 */
export function AuthGuard({ children, redirect, fallback = null }: AuthGuardProps) {
  const { isAuthenticated, sessionValidated } = useAuth();

  useEffect(() => {
    if (sessionValidated && !isAuthenticated) redirect();
  }, [sessionValidated, isAuthenticated, redirect]);

  if (isAuthenticated) return <>{children}</>;
  return <>{fallback}</>;
}
