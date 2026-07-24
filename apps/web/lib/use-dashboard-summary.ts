"use client";

import { useEffect } from "react";

import { invalidateKeys, keys } from "@repo/api";
import { useNavQueries, useQuery, useQueryClient } from "@repo/api/react";
import { useChannel } from "@repo/realtime/react";
import type { DashboardSummaryResponse } from "@repo/validators";

import { useRealtime } from "../app/realtime-provider";
import { useActiveOrgId } from "./use-role";

/**
 * The owner "Přehled" dashboard aggregate (ADR 0125, Wave D) — ONE fetch of
 * `GET /v1/me/dashboard-summary`, the sibling of `useNavCounts`. The `/`
 * dashboard RSC PREFETCHES this query and dehydrates it, so this hook reads the
 * hydrated cache with no client refetch on first render (the same
 * prefetch+hydrate shape as `/orders`); it then keeps the surface live.
 *
 * Freshness is push-driven exactly like the nav counts: subscribe to the tenant
 * realtime channel `org:<id>` (ADR 0055) and INVALIDATE the summary on any
 * domain event there — never mutate the cache from a push payload (payloads are
 * IDs, §4.1 / ADR 0037). Focus-refetch + navigation cover the surfaces that do
 * not yet emit an event, so the numbers self-correct regardless.
 *
 * `active` gates the whole thing (fetch, socket, subscription); combined with a
 * resolved `orgId` (an org-less session 403s the org-scoped endpoint) it avoids
 * noise before the session settles.
 *
 * Returns `undefined` until the query resolves; the caller renders skeletons /
 * nothing in that window. Role-filtering is server-side via OPTIONAL keys, so an
 * absent key means "not shown" (workshop is deliberately sparse), never 0.
 */
export function useDashboardSummary(
  { active }: { active: boolean } = { active: true },
): DashboardSummaryResponse | undefined {
  const orgId = useActiveOrgId();
  const navQueries = useNavQueries();
  const queryClient = useQueryClient();
  const client = useRealtime();

  const enabled = active && orgId !== null;

  const { data } = useQuery({
    ...navQueries.dashboardSummary(),
    enabled,
    staleTime: 30_000,
  });

  // connect() is idempotent on the adapter; the RealtimeProvider owns disconnect.
  useEffect(() => {
    if (enabled) client.connect();
  }, [client, enabled]);

  // Any publication on the org channel may move a counted surface (an order/
  // quote transition) — re-fetch the whole (cheap, PII-free) aggregate rather
  // than reason about which field changed.
  useChannel<{ type: string }>(client, enabled ? `org:${orgId}` : null, {
    onPublication: () => {
      void invalidateKeys(queryClient, [keys.nav.dashboardSummary()]);
    },
  });

  return data;
}
