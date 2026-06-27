import { defineQuery, mutationOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import {
  legalProfileResponseSchema,
  legalProfileSchema,
  upsertLegalProfileSchema,
  type LegalProfile,
  type UpsertLegalProfileInput,
} from "@repo/validators";

/**
 * Org legal-profile endpoint factory + key tier (ADR 0088) — the singleton
 * supplier identity behind the nabídka. `get` returns null for a not-yet-
 * completed org (the empty state); `upsert` is the full-document PUT. App-side
 * consumption layer, mirroring `createCustomersQueries`.
 */
export const legalProfileKeys = {
  all: ["legal-profile"] as const,
  detail: () => [...legalProfileKeys.all, "detail"] as const,
} as const;

export function createLegalProfileQueries(client: ApiClient) {
  return {
    get: () =>
      defineQuery<LegalProfile | null>(client, {
        queryKey: legalProfileKeys.detail(),
        path: "/v1/org/legal-profile",
        schema: (data) => legalProfileResponseSchema.parse(data).profile,
      }),

    upsert: () =>
      mutationOptions({
        mutationFn: (input: UpsertLegalProfileInput) =>
          client.apiFetch<LegalProfile>("/v1/org/legal-profile", {
            method: "PUT",
            body: upsertLegalProfileSchema.parse(input),
            parse: (data) => legalProfileSchema.parse(data),
          }) as Promise<LegalProfile>,
      }),
  };
}
