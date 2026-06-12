import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createServerApiClient } from "../../lib/server-api";
import { AccountClient } from "./account-client";

/**
 * Protected page. An RSC that prefetches the authed `me()` query as the user —
 * `createServerApiClient` forwards the incoming request's httpOnly Better Auth
 * session cookie (design §7.1) — and dehydrates it into the boundary, so the
 * client leaf renders the profile from hydrated cache with no refetch — the
 * ADR-0007 prefetch pipeline on a protected route.
 *
 * Best-effort: a stale/revoked session 401s here and the browser client
 * refetches after hydration. The proxy gate + <AuthGuard> handle access.
 */
export default async function AccountPage() {
  const authQueries = createAuthQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(authQueries.me());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <AccountClient />
    </HydrationBoundary>
  );
}
