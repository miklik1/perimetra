"use client";

import { useMemo, useState, type ReactNode } from "react";

import { createAuthClient, type AuthClient } from "../client";
import { AuthContext } from "./auth-context";

export interface AuthProviderProps {
  /**
   * Auth server origin. Omit on web — the Next.js rewrite makes `/api/auth/*`
   * same-origin. Required on native (no proxy). Ignored when `client` is given.
   */
  baseUrl?: string;
  /**
   * Pre-built client for platforms that need extra client plugins (e.g. the
   * Expo SecureStore plugin — see apps/mobile/lib/auth-client.ts). Read once
   * at mount, like `ApiProvider`'s `initialQueryClient`.
   */
  client?: AuthClient;
  /**
   * SSR seed for the first paint: `true` when the request that rendered this
   * tree carried a session cookie. Defaults to `false`, which reproduces the
   * pre-seed behaviour exactly (every guard paints its fallback on the server).
   * Presence is a render hint, never authorization — see `AuthContextValue`.
   */
  initiallyAuthenticated?: boolean;
  children: ReactNode;
}

/**
 * Owns the Better Auth client for the subtree. Builds it once per mount via a
 * `useState` initializer (the same one-per-mount, no-module-global pattern as
 * `ApiProvider`, ADR 0012). Mount INSIDE `<ApiProvider>` so `useAuth` can reach
 * the QueryClient for the logout cache clear.
 *
 * It also carries the server's `initiallyAuthenticated` render hint down the
 * tree (ADR 0135), so `AuthGuard` and the host app's shell can paint the
 * authenticated layout on the FIRST byte instead of after hydration. Unlike the
 * client, the hint is a plain prop re-read on every render: Better Auth's
 * session store cannot be seeded (its React adapter uses the same getter for
 * `getSnapshot` and `getServerSnapshot`, and its query no-ops on the server),
 * so the seed has to ride above it as React data.
 */
export function AuthProvider({
  baseUrl,
  client,
  initiallyAuthenticated = false,
  children,
}: AuthProviderProps) {
  const [authClient] = useState(() => client ?? createAuthClient({ baseURL: baseUrl }));
  const value = useMemo(
    () => ({ client: authClient, initiallyAuthenticated }),
    [authClient, initiallyAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
