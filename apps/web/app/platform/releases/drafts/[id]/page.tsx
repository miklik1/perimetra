import { notFound } from "next/navigation";

import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createPlatformQueries } from "../../../../../lib/platform-queries";
import { createServerApiClient } from "../../../../../lib/server-api";
import { ReleaseEditorClient, type LoadedDraft } from "../../release-editor";

/**
 * Resume a saved release draft (ADR 0068 Phase 3B). Loads the draft server-side
 * so the editor seeds without a flash; a missing/foreign id → notFound (the
 * draft store is org-scoped + vendor-only, so it is genuinely not found).
 * Prefetches `me()` so the client gate renders without a refetch flash.
 */
export default async function DraftEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await createServerApiClient();
  const qc = getQueryClient();
  await qc.prefetchQuery(createAuthQueries(client).me());

  const draft = await qc.fetchQuery(createPlatformQueries(client).draft(id)).catch(() => null);
  if (!draft) notFound();

  const initial: LoadedDraft = {
    id: draft.id,
    body: draft.body,
    baseReleaseId: draft.baseReleaseId,
  };

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ReleaseEditorClient initial={initial} />
    </HydrationBoundary>
  );
}
