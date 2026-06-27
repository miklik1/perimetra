import { mutationOptions, queryOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import {
  aresLookupSchema,
  viesLookupSchema,
  type AresLookup,
  type ViesLookup,
} from "@repo/validators";

/**
 * Registry-lookup endpoint factory (ADR 0090) — ARES IČO prefill + VIES DIČ
 * validation. App-side consumption layer, mirroring `createCustomersQueries`.
 *
 * Both endpoints are POST with the key in the BODY (the key is `pii()` — keeping
 * it out of the URL keeps it out of the request log / browser history). `ares` is
 * a mutation (the form fires it on a button click); `vies` is a reactive query
 * the caller gates with `enabled` on a valid DIČ. Both fail soft server-side, so
 * the result `status` (never an error) drives the UI.
 */
const lookupKeys = {
  all: ["lookups"] as const,
  vies: (dic: string) => [...lookupKeys.all, "vies", dic] as const,
} as const;

export function createLookupsQueries(client: ApiClient) {
  return {
    ares: () =>
      mutationOptions({
        mutationFn: (ico: string) =>
          client.apiFetch<AresLookup>("/v1/lookups/ares", {
            method: "POST",
            body: { ico },
            parse: (data) => aresLookupSchema.parse(data),
          }) as Promise<AresLookup>,
      }),

    vies: (dic: string) =>
      queryOptions({
        queryKey: lookupKeys.vies(dic),
        queryFn: ({ signal }) =>
          client.apiFetch<ViesLookup>("/v1/lookups/vies", {
            method: "POST",
            body: { dic },
            signal,
            parse: (data) => viesLookupSchema.parse(data),
          }) as Promise<ViesLookup>,
      }),
  };
}
