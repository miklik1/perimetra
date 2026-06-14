"use client";

import { useAuthQueries, useQuery } from "@repo/api/react";
import type { OrgRole } from "@repo/validators";

/**
 * The caller's active-org role (ADR 0056), read from the SAME `/v1/me` source
 * the BE guards enforce on — so FE gating can never drift from server-side
 * enforcement. `null` while the session probe is in flight or the user is
 * anonymous.
 */
function useRole(): OrgRole | null {
  const authQueries = useAuthQueries();
  const { data } = useQuery(authQueries.me());
  return data?.role ?? null;
}

/**
 * FE mirror of the server price-blind rule — FAIL-CLOSED: prices show only for a
 * CONFIRMED `admin`/`sales` role. While the role is unknown (loading/anonymous)
 * or `workshop`, prices stay hidden. Defence in depth only — the authoritative
 * strip is server-side (the API never ships prices to a workshop client).
 */
export function usePriceBlind(): boolean {
  const role = useRole();
  return role !== "admin" && role !== "sales";
}
