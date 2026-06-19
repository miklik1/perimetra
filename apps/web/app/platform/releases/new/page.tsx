import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createServerApiClient } from "../../../../lib/server-api";
import { ReleaseEditorClient } from "../release-editor";

/**
 * Structured release editor (ADR 0068) — the model-IDE that replaces the
 * raw-JSON publish form. Prefetches `me()` so the client leaf renders the
 * platform gate (`isPlatformAdmin`) without a refetch flash; Publish goes
 * through the existing immutable `POST /v1/releases` (PlatformGuard-enforced).
 */
export default async function NewReleasePage() {
  const authQueries = createAuthQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(authQueries.me());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ReleaseEditorClient />
    </HydrationBoundary>
  );
}
