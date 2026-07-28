"use client";

import { useEffect } from "react";

import { invalidateKeys, keys } from "@repo/api";
import { useNavQueries, useQuery, useQueryClient } from "@repo/api/react";
import { useChannel } from "@repo/realtime/react";
import type { NavCountsResponse } from "@repo/validators";

import { useRealtime } from "../app/realtime-provider";
import { useActiveOrgId } from "./use-role";

/**
 * The app-shell nav-count badges (1c-3). ONE fetch of `GET /v1/me/nav-counts`
 * (design §4.1), shared by all three density rails through the shell — the rails
 * stay pure consumers of this map, exactly as they are of `visibleNavEntries`.
 *
 * Freshness is push-driven: the shell subscribes to the tenant realtime channel
 * `org:<id>` (ADR 0055) and, on any domain event there (order/invoice
 * transitions today), INVALIDATES the counts so TanStack re-fetches the truth —
 * never mutating the cache from a push payload (payloads are IDs, §4.1 / ADR
 * 0037). Focus-refetch + navigation cover the surfaces that do not yet emit an
 * event (quotes have no outbox stream), so the pill self-corrects regardless.
 *
 * `active` is the shell's framed-and-authenticated gate: the whole thing — fetch,
 * socket, subscription — only runs when it is true, so a chromeless print sheet
 * or public preview (which renders bare) opens no socket and polls nothing, and
 * anonymous routes pay nothing.
 *
 * Returns `{}` until the query resolves; an absent key means "no pill", never 0
 * (the caller cannot see that surface — the endpoint role-filters).
 */
export function useNavCounts(
  { active }: { active: boolean } = { active: true },
): NavCountsResponse {
  const orgId = useActiveOrgId();
  const navQueries = useNavQueries();
  const queryClient = useQueryClient();
  const client = useRealtime();

  // Run only on a framed authed route with a resolved org to scope the counts to
  // — an org-less session 403s the (org-scoped) endpoint, so gating avoids noise.
  const enabled = active && orgId !== null;

  const { data } = useQuery({
    ...navQueries.navCounts(),
    enabled,
    staleTime: 30_000,
  });

  // connect() is idempotent on the adapter; the RealtimeProvider owns disconnect.
  useEffect(() => {
    if (enabled) client.connect();
  }, [client, enabled]);

  // Any publication on the org channel may move a counted surface — re-fetch the
  // whole (cheap, PII-free) aggregate rather than reason about which key changed.
  //
  // THIS CHANNEL IS SHARED with `useDashboardSummary`, and both hooks are mounted
  // on `/`. That was a live bug until the ADR 1039 fan-out registry landed: the
  // adapter threw on the second subscribe to a channel and `useChannel` swallowed
  // the throw, so whichever of the two mounted second silently got no
  // subscription and degraded to focus-refetch. Both now receive every
  // publication. Do NOT give either hook a `since` without giving it to both —
  // one consumer asking for history while the other does not is a
  // `since-conflict`, and which one throws depends on mount order (AppShell
  // parent vs DashboardClient child), so it fires asymmetrically.
  useChannel<{ type: string }>(client, enabled ? `org:${orgId}` : null, {
    onPublication: () => {
      void invalidateKeys(queryClient, [keys.nav.counts()]);
    },
  });

  return data ?? {};
}
