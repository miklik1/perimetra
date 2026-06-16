import { isUnauthorized } from "@repo/api";

import { createServerApiClient } from "../../lib/server-api";
import { fetchCatalogBundle } from "./catalog-bundle";
import { ConfiguratorClient } from "./configurator-client";
import type { CatalogBundle } from "./products";

/**
 * Protected configurator page (step 6 slice 1; api-served catalog, ADR 0060). The
 * RSC fetches the catalog bundle as the user (`createServerApiClient` forwards the
 * httpOnly session) and prop-passes it; the engine still runs client-side (pure,
 * I1). Access is owned by the proxy gate (`/configurator` in PROTECTED_PREFIXES) +
 * <AuthGuard> in the client subtree.
 *
 * A stale/revoked session 401s here → pass a null bundle; the client AuthGuard
 * resolves the session on mount and redirects to /login (the same best-effort the
 * /site RSC has).
 */
export default async function ConfiguratorPage() {
  const api = await createServerApiClient();

  let bundle: CatalogBundle | null = null;
  try {
    bundle = await fetchCatalogBundle(api);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }

  return <ConfiguratorClient bundle={bundle} />;
}
