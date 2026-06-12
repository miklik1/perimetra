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
  children: ReactNode;
}

/**
 * Owns the Better Auth client for the subtree. Builds it once per mount via a
 * `useState` initializer (the same one-per-mount, no-module-global pattern as
 * `ApiProvider`, ADR 0012). Mount INSIDE `<ApiProvider>` so `useAuth` can reach
 * the QueryClient for the logout cache clear.
 */
export function AuthProvider({ baseUrl, client, children }: AuthProviderProps) {
  const [authClient] = useState(() => client ?? createAuthClient({ baseURL: baseUrl }));
  const value = useMemo(() => ({ client: authClient }), [authClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
