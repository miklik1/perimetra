"use client";

import { createContext, useContext } from "react";

import { type AuthClient } from "../client";

export interface AuthContextValue {
  /** The Better Auth client owned by the nearest `<AuthProvider>`. */
  client: AuthClient;
  /**
   * SSR render hint: did the request that produced this HTML carry a session
   * cookie? Seeded by the host app from the server (web: the root layout reads
   * `headers()` and calls `hasSessionCookie` — the same PRESENCE check the
   * request-time proxy gate already trusts), so the server can paint the
   * authenticated tree instead of every guard's loading fallback.
   *
   * This is NOT authentication and must never authorize anything: a cookie can
   * be stale or revoked, and only the API service knows. It exists so the
   * FIRST paint matches the overwhelmingly likely outcome; the moment Better
   * Auth's session resolves, `isAuthenticated` takes over and a confirmed
   * unauthenticated session still redirects (see `AuthGuard`).
   */
  initiallyAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Read the auth context. Throws if used outside `<AuthProvider>`. */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth/AuthGuard must be used within <AuthProvider>");
  return ctx;
}

/**
 * The full Better Auth client for flows beyond `useAuth`'s surface — sign-in
 * (`client.signIn.email`), sign-up, password reset, admin actions. Kept as a
 * separate hook so `useAuth` stays a small identity surface.
 */
export function useAuthClient(): AuthClient {
  return useAuthContext().client;
}
