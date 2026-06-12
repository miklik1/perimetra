"use client";

import { createContext, useContext } from "react";

import { type AuthClient } from "../client";

export interface AuthContextValue {
  /** The Better Auth client owned by the nearest `<AuthProvider>`. */
  client: AuthClient;
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
