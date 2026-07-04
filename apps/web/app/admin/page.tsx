import {
  createAuthQueries,
  dehydrate,
  getQueryClient,
  HydrationBoundary,
  isUnauthorized,
} from "@repo/api";

import { createServerApiClient } from "../../lib/server-api";
import { fetchCatalogBundle } from "../configurator/catalog-bundle";
import { AdminClient } from "./admin-client";

/**
 * Tenant admin page (ADR 0061, retiered by ADR 0062): the org's price tables.
 * Catalog/release publishing + per-tenant assignment moved to `/platform`
 * (vendor console). Prefetches `me()` so the client leaf renders the role-correct
 * UI (admin gate) without a refetch flash. The price-table POST is
 * `@RequireRole('admin')` — the server enforces; the client gate is UX only.
 *
 * Also fetches the org's catalog bundle (same `fetchCatalogBundle` the
 * configurator/site use, ADR 0060) purely to harvest component CODES across
 * every pinned release's catalog — a cheap, read-only `<datalist>` suggestion
 * for the price-table form's component rows (CAR-15). No new endpoint. A
 * stale/revoked session or an org with nothing assigned degrades to an empty
 * list (the code input just falls back to plain text) rather than failing the
 * page — this fetch is a suggestion, never load-bearing.
 */
export default async function AdminPage() {
  const api = await createServerApiClient();
  const authQueries = createAuthQueries(api);
  const qc = getQueryClient();
  await qc.prefetchQuery(authQueries.me());

  let componentCodes: string[] = [];
  try {
    const bundle = await fetchCatalogBundle(api);
    componentCodes = [
      ...new Set(
        [...bundle.catalogs.values()].flatMap((catalog) => catalog.components.map((c) => c.code)),
      ),
    ].sort();
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <AdminClient componentCodes={componentCodes} />
    </HydrationBoundary>
  );
}
