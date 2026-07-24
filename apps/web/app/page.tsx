import {
  createNavQueries,
  dehydrate,
  getQueryClient,
  HydrationBoundary,
  isUnauthorized,
} from "@repo/api";

import { createServerApiClient } from "../lib/server-api";
import { DashboardClient } from "./dashboard-client";

/**
 * The owner "Přehled" dashboard (ADR 0125, Phase 2 Wave D) — the bare `/` route,
 * now the real authenticated home (this retires the fullstack-skeleton root
 * demo). It follows the `/orders` prefetch+hydrate shape: this RSC fetches the
 * dashboard summary AS THE USER (session cookie forwarded via
 * `createServerApiClient`) and dehydrates it, so the client leaf renders from
 * hydrated cache with no refetch flash. The app shell (ADR 0118) frames `/`
 * automatically when authed — `/` is NOT chromeless — and renders the page bare
 * when not, so the client `<AuthGuard>` fallback shows and redirects.
 *
 * An UNAUTHENTICATED visitor to `/` must still render (the client AuthGuard owns
 * the redirect), so the authed prefetch SWALLOWS a 401 — same pattern as
 * `/admin`. `/` is deliberately NOT in the proxy PROTECTED_PREFIXES: a `/`
 * prefix would match every route, so access here is owned by the AuthGuard
 * subtree + the org-scoped endpoint itself.
 */
export default async function DashboardPage() {
  const qc = getQueryClient();
  try {
    const navQueries = createNavQueries(await createServerApiClient());
    await qc.prefetchQuery(navQueries.dashboardSummary());
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <DashboardClient />
    </HydrationBoundary>
  );
}
