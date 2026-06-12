"use client";

import { useCallback, useMemo } from "react";

import { useQueryClient } from "@repo/api/react";
import { type User } from "@repo/validators";

import { useAuthContext } from "./auth-context";

export interface UseAuthResult {
  user: User | null;
  isAuthenticated: boolean;
  /**
   * `false` only while the initial cookie-session fetch is in flight
   * (`useSession().isPending`); once `true`, `isAuthenticated` is the server's
   * answer, not an optimistic guess.
   */
  sessionValidated: boolean;
  /** Full logout: revoke the server session, then clear the query cache. */
  logout: () => Promise<void>;
  /** Re-fetch the session (e.g. after a profile update). */
  refetch: () => void;
}

/**
 * The app-facing auth hook, backed by Better Auth's reactive `useSession`
 * (sign-in/sign-out update every subscriber — no hand-rolled store). Sign-in
 * and the richer flows live on the client itself (`useAuthClient()`); this
 * surface is identity + logout, what screens and the analytics bridge consume.
 */
export function useAuth(): UseAuthResult {
  const { client } = useAuthContext();
  const queryClient = useQueryClient();
  const { data, isPending, refetch } = client.useSession();

  const sessionUser = data?.user;
  const user = useMemo<User | null>(() => {
    if (!sessionUser) return null;
    // Normalize onto the repo-wide `User` contract (@repo/validators): the
    // typed client declares `createdAt` as a Date but it arrives as an ISO
    // string over the wire; admin-plugin fields (role/banned) are dropped.
    return {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      createdAt: new Date(sessionUser.createdAt).toISOString(),
    };
  }, [sessionUser]);

  const logout = useCallback(async () => {
    // `signOut` reports failure as a value, never throws; the session atom
    // flips to null either way once the server confirms. The cache clear runs
    // after so no authed data lingers for the next (anonymous) render.
    await client.signOut();
    queryClient.clear();
  }, [client, queryClient]);

  return {
    user,
    isAuthenticated: Boolean(sessionUser),
    sessionValidated: !isPending,
    logout,
    refetch,
  };
}
