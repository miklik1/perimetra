import { defineInfiniteQuery, defineMutation, defineQuery, mutationOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams } from "@repo/utils";
import {
  catalogVersionSchema,
  catalogVersionsPageSchema,
  pinVersionSchema,
  priceTableSchema,
  priceTablesPageSchema,
  publishCatalogVersionSchema,
  publishPriceTableSchema,
  publishReleaseSchema,
  releaseSchema,
  releasesPageSchema,
  upgradeOffersSchema,
  type CatalogVersionDetail,
  type CatalogVersionsPage,
  type PinVersionInput,
  type PriceTableDetail,
  type PriceTablesPage,
  type PublishCatalogVersionInput,
  type PublishPriceTableInput,
  type PublishReleaseInput,
  type ReleaseDetail,
  type ReleasesPage,
  type UpgradeOffers,
} from "@repo/validators";

export const adminKeys = {
  all: ["admin"] as const,
  catalogVersions: () => [...adminKeys.all, "catalog-versions"] as const,
  catalogVersionsList: () => [...adminKeys.catalogVersions(), "list"] as const,
  releases: () => [...adminKeys.all, "releases"] as const,
  releasesList: () => [...adminKeys.releases(), "list"] as const,
  priceTables: () => [...adminKeys.all, "price-tables"] as const,
  priceTablesList: () => [...adminKeys.priceTables(), "list"] as const,
  upgrades: () => [...adminKeys.releases(), "upgrades"] as const,
} as const;

export interface PublishCatalogVariables {
  input: PublishCatalogVersionInput;
  idempotencyKey: string;
}

export interface PublishReleaseVariables {
  input: PublishReleaseInput;
  idempotencyKey: string;
}

export interface PublishPriceTableVariables {
  input: PublishPriceTableInput;
  idempotencyKey: string;
}

export function createAdminQueries(client: ApiClient) {
  return {
    listCatalogVersions: () =>
      defineInfiniteQuery<CatalogVersionsPage, string>(client, {
        queryKey: adminKeys.catalogVersionsList(),
        initialPageParam: "",
        path: (cursor) =>
          appendSearchParams("/v1/catalog-versions", { cursor: cursor || undefined }),
        schema: (data) => catalogVersionsPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),

    publishCatalogVersion: () =>
      mutationOptions({
        mutationFn: ({ input, idempotencyKey }: PublishCatalogVariables) =>
          client.apiFetch<CatalogVersionDetail>("/v1/catalog-versions", {
            method: "POST",
            body: publishCatalogVersionSchema.parse(input),
            headers: { "Idempotency-Key": idempotencyKey },
            parse: (data) => catalogVersionSchema.parse(data),
          }),
      }),

    listReleases: () =>
      defineInfiniteQuery<ReleasesPage, string>(client, {
        queryKey: adminKeys.releasesList(),
        initialPageParam: "",
        path: (cursor) =>
          appendSearchParams("/v1/releases", {
            status: "published",
            cursor: cursor || undefined,
          }),
        schema: (data) => releasesPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),

    publishRelease: () =>
      mutationOptions({
        mutationFn: ({ input, idempotencyKey }: PublishReleaseVariables) =>
          client.apiFetch<ReleaseDetail>("/v1/releases", {
            method: "POST",
            body: publishReleaseSchema.parse(input),
            headers: { "Idempotency-Key": idempotencyKey },
            parse: (data) => releaseSchema.parse(data),
          }),
      }),

    listPriceTables: () =>
      defineInfiniteQuery<PriceTablesPage, string>(client, {
        queryKey: adminKeys.priceTablesList(),
        initialPageParam: "",
        path: (cursor) => appendSearchParams("/v1/price-tables", { cursor: cursor || undefined }),
        schema: (data) => priceTablesPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),

    /** Models with an available opt-in upgrade (ADR 0064) — the org is pinned to
     *  an older version than the newest one the vendor has assigned it. */
    listUpgrades: () =>
      defineQuery<UpgradeOffers>(client, {
        queryKey: adminKeys.upgrades(),
        path: "/v1/releases/upgrades",
        schema: (data) => upgradeOffersSchema.parse(data),
      }),

    /** Opt into a version: move the org's pin for that release's model (admin). */
    pinVersion: () =>
      defineMutation<UpgradeOffers, PinVersionInput>(client, {
        method: "POST",
        path: "/v1/releases/pin",
        body: (input) => pinVersionSchema.parse(input),
        schema: (data) => upgradeOffersSchema.parse(data),
      }),

    publishPriceTable: () =>
      mutationOptions({
        mutationFn: ({ input, idempotencyKey }: PublishPriceTableVariables) =>
          client.apiFetch<PriceTableDetail>("/v1/price-tables", {
            method: "POST",
            body: publishPriceTableSchema.parse(input),
            headers: { "Idempotency-Key": idempotencyKey },
            parse: (data) => priceTableSchema.parse(data),
          }),
      }),
  };
}
