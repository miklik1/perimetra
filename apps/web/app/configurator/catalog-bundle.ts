import "server-only";

import { isForbidden, isNotFound, type ApiClient } from "@repo/api";
import type { ConfigInput, PriceTable } from "@repo/engine";
import type { Catalog, ProductModelRelease } from "@repo/model";
import { appendSearchParams } from "@repo/utils";
import {
  catalogVersionSchema,
  priceTableSchema,
  releaseSchema,
  releasesPageSchema,
  type ReleaseSummary,
} from "@repo/validators";

import type { CatalogBundle, ConfigurableProduct } from "./products";

/**
 * Assemble the configurator/site bundle from the api (ADR 0060, over the ADR 0053
 * immutable stores). RSC-only by use — an RSC fetches it with
 * `createServerApiClient` (the session is forwarded) and prop-passes the result
 * to the client surfaces (never import this from a client component).
 *
 * Steps: list published releases (follow the keyset cursor) → fetch each body and
 * its `initialInput` (the list ships metadata only) and the one catalog version
 * they pin → fetch the org's active price table. A 403 on the price table
 * (workshop, ADR 0056) or a 404 (no active table) yields `prices: null` — never a
 * throw, so the surface degrades to price-blind instead of erroring.
 */
const RELEASES_PAGE_LIMIT = 100;

export async function fetchCatalogBundle(client: ApiClient): Promise<CatalogBundle> {
  // 1. Every published release (follow the keyset cursor).
  const summaries: ReleaseSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.apiFetch(
      appendSearchParams("/v1/releases", {
        status: "published",
        limit: RELEASES_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      }),
      { parse: (d) => releasesPageSchema.parse(d) },
    );
    summaries.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  if (summaries.length === 0) return { products: [], catalog: null, prices: null };

  // 2. Each release body + initialInput (the list ships metadata only).
  const details = await Promise.all(
    summaries.map((s) =>
      client.apiFetch(`/v1/releases/${s.id}`, { parse: (d) => releaseSchema.parse(d) }),
    ),
  );
  const products: ConfigurableProduct[] = details.map((d) => ({
    release: d.body as ProductModelRelease,
    initialInput: (d.initialInput as ConfigInput | null) ?? {},
  }));

  // 3. The shared catalog every release pins (one version this slice — the
  // engine's `deriveSite` takes a single catalog). A release pinning a different
  // version is unsupported here, so FAIL LOUD rather than silently serving the
  // wrong catalog (mirrors the quotes `mixed_catalog` guard; per-release catalog
  // is the deferred ADR 0060 follow-up). I5: no silent wrong result.
  const catalogVersion = summaries[0]!.catalogVersion;
  const mixed = summaries.some((s) => s.catalogVersion !== catalogVersion);
  if (mixed) {
    const versions = [...new Set(summaries.map((s) => s.catalogVersion))].sort((a, b) => a - b);
    throw new Error(
      `Published releases pin different catalog versions (${versions.join(", ")}) — cannot assemble one catalog. Retire or re-pin the conflicting release.`,
    );
  }
  const catalogDetail = await client.apiFetch(`/v1/catalog-versions/by-version/${catalogVersion}`, {
    parse: (d) => catalogVersionSchema.parse(d),
  });
  const catalog = catalogDetail.body as Catalog;

  // 4. The org's active price table (price-blind / none → null, not an error).
  let prices: PriceTable | null = null;
  try {
    const active = await client.apiFetch("/v1/price-tables/active", {
      parse: (d) => priceTableSchema.parse(d),
    });
    prices = active.table as PriceTable;
  } catch (error) {
    if (!isForbidden(error) && !isNotFound(error)) throw error;
  }

  return { products, catalog, prices };
}
