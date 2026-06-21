"use client";

import * as React from "react";

import { useApiClient, useQuery } from "@repo/api/react";
import type { Catalog } from "@repo/model";

import { createPlatformQueries } from "../../../../lib/platform-queries";

interface PlatformCatalog {
  /** Published catalog versions — the identity workbench's version picker. */
  versions: { id: string; version: number }[];
  /** The full `Catalog` for the draft's selected version, once loaded (the part
   *  pickers' option source + the catalog-aware `validateRelease` arg). `null`
   *  until a published version matches the draft's `catalogVersion`. */
  catalog: Catalog | null;
  isLoading: boolean;
}

/**
 * Loads the catalog options behind the editor's catalog-aware pickers (ADR 0068
 * Phase 2): list the published versions, resolve the draft's `catalogVersion`
 * number to its surrogate id, then fetch that version's body. The body is passed
 * to `validateRelease(release, catalog)` so the editor's role/section/material
 * checks are byte-identical to the server publish gate (which loads the same
 * catalog). Degrades to `catalog: null` when nothing is published yet — the
 * editor still authors (the server stays the authority).
 */
export function usePlatformCatalog(version: number): PlatformCatalog {
  const client = useApiClient();
  const queries = React.useMemo(() => createPlatformQueries(client), [client]);

  const list = useQuery(queries.listCatalogVersions());
  const versions = React.useMemo(() => list.data?.items ?? [], [list.data]);
  const match = versions.find((v) => v.version === version);

  const detail = useQuery({ ...queries.catalogVersion(match?.id ?? ""), enabled: !!match });
  const catalog = (detail.data?.body as Catalog | undefined) ?? null;

  return {
    versions,
    catalog,
    isLoading: list.isLoading || (!!match && detail.isLoading),
  };
}
