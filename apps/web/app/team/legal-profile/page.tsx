import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createLegalProfileQueries } from "../../../lib/legal-profile-queries";
import { createServerApiClient } from "../../../lib/server-api";
import { LegalProfileClient } from "./legal-profile-client";

/**
 * Org legal-profile settings (ADR 0088) — the admin-only surface that supplies
 * the dodavatel block of every nabídka. Prefetches `me()` (role gate) + the
 * profile so the client form renders pre-filled without a refetch flash; a
 * non-admin's profile prefetch 403s and is swallowed (the client shows a notice).
 */
export default async function LegalProfilePage() {
  const client = await createServerApiClient();
  const authQueries = createAuthQueries(client);
  const legalQueries = createLegalProfileQueries(client);
  const qc = getQueryClient();
  await qc.prefetchQuery(authQueries.me());
  await qc.prefetchQuery(legalQueries.get());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <LegalProfileClient />
    </HydrationBoundary>
  );
}
