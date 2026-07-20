import "server-only";

import { isForbidden, isNotFound, type ApiClient } from "@repo/api";
import type { ConfigInput, CostTable, PriceTable } from "@repo/engine";
import type { Catalog, ProductModelRelease, RoundingPolicy } from "@repo/model";
import { appendSearchParams } from "@repo/utils";
import {
  catalogVersionSchema,
  priceTableSchema,
  releaseSchema,
  releasesPageSchema,
  type ReleaseSummary,
} from "@repo/validators";

import type { CatalogBundle, ConfigurableProduct, ConfiguratorPricing } from "./products";

/**
 * Assemble the configurator/site bundle from the api (ADR 0060, over the ADR 0053
 * immutable stores). RSC-only by use — an RSC fetches it with
 * `createServerApiClient` (the session is forwarded) and prop-passes the result
 * to the client surfaces (never import this from a client component).
 *
 * Steps: list published releases (follow the keyset cursor) → fetch each body and
 * its `initialInput` (the list ships metadata only) → fetch each DISTINCT catalog
 * version the pinned set references and key it by release id (per-release catalog,
 * ADR 0065) → fetch the org's active price table. A 403 on the price table
 * (workshop, ADR 0056) or a 404 (no active table) yields `prices: null` — never a
 * throw, so the surface degrades to price-blind instead of erroring.
 *
 * `/v1/releases` returns the org's PINNED version per model (ADR 0064 — assigned
 * AND the active pin), so the configurator picker shows ONE version per product;
 * a newer assigned version is an opt-in offer (`/admin`), never a parallel entry.
 * Per-release catalog (ADR 0065) means those pinned products may carry DIFFERENT
 * catalog versions — each release derives against its own catalog, so there is no
 * longer a single-catalog guard (a referenced version that 404s still throws, I5).
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
    // A list endpoint always returns a body (never 204); narrow the honest
    // `… | undefined` from raw apiFetch.
    summaries.push(...page!.items);
    cursor = page!.nextCursor ?? undefined;
  } while (cursor);

  if (summaries.length === 0) return { products: [], catalogs: new Map(), pricing: null };

  // 2. Each release body + initialInput (the list ships metadata only).
  const details = await Promise.all(
    summaries.map((s) =>
      client.apiFetch(`/v1/releases/${s.id}`, { parse: (d) => releaseSchema.parse(d) }),
    ),
  );
  const products: ConfigurableProduct[] = details.map((d, i) => ({
    release: d!.body as ProductModelRelease,
    initialInput: (d!.initialInput as ConfigInput | null) ?? {},
    // `details` is `Promise.all` over `summaries` in order, so index i pairs.
    catalogVersion: summaries[i]!.catalogVersion,
  }));

  // 3. Per-release catalog (ADR 0065): each release derives against its OWN pinned
  // catalog version — mixed versions coexist. Fetch each DISTINCT version once,
  // then key by release id so the engine routes every instance to its catalog
  // (products sharing a version share the Catalog object). A referenced version
  // that 404s still throws (a published release must reference a published
  // catalog, I5) — there is no longer a single-catalog guard.
  const distinctVersions = [...new Set(summaries.map((s) => s.catalogVersion))];
  const catalogByVersion = new Map<number, Catalog>(
    await Promise.all(
      distinctVersions.map(async (v): Promise<[number, Catalog]> => {
        const detail = await client.apiFetch(`/v1/catalog-versions/by-version/${v}`, {
          parse: (d) => catalogVersionSchema.parse(d),
        });
        return [v, detail!.body as Catalog];
      }),
    ),
  );
  const catalogs = new Map<string, Catalog>(
    products.map((p, i) => [p.release.id, catalogByVersion.get(summaries[i]!.catalogVersion)!]),
  );

  // 4. The org's active pricing (price-blind / none → null, not an error).
  //
  // The endpoint has always shipped the whole commercial row; until ADR 0116 this
  // kept `table` and dropped the rest, so the client engine ran with no cost
  // layer (no margin was renderable at all) and under the DEFAULT rounding policy
  // rather than the org's — the configurator's price could therefore differ from
  // the one `issue` freezes. All four layers now travel together.
  let pricing: ConfiguratorPricing | null = null;
  try {
    const active = await client.apiFetch("/v1/price-tables/active", {
      parse: (d) => priceTableSchema.parse(d),
    });
    if (active) {
      pricing = {
        table: active.table as PriceTable,
        cost: (active.cost as CostTable | null) ?? null,
        // Decimal string on the wire (a percent, 0–100 — the same units the
        // server guard compares against); null when the org sets no floor.
        marginFloorPct: active.marginFloorPct === null ? null : Number(active.marginFloorPct),
        rounding: active.roundingPolicy as RoundingPolicy,
      };
    }
  } catch (error) {
    if (!isForbidden(error) && !isNotFound(error)) throw error;
  }

  return { products, catalogs, pricing };
}
