"use client";

// Client-only surface (`@repo/auth/react`): provider, hooks, and the route
// guard. Mount `<AuthProvider>` inside `<ApiProvider>`. These are React but
// DOM-agnostic, so they type-check under both web and RN. The Better Auth
// client factory + cookie helpers are on `@repo/auth` (`./index`).
export { AuthProvider } from "./react/auth-provider";
export type { AuthProviderProps } from "./react/auth-provider";
export { useAuth } from "./react/use-auth";
export type { UseAuthResult } from "./react/use-auth";
export { useAuthClient } from "./react/auth-context";
export { AuthGuard } from "./react/auth-guard";
export type { AuthGuardProps } from "./react/auth-guard";
