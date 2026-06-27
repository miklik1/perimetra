import { type AresLookup, type ViesLookup } from "@repo/validators";

import { type MockRoute } from "../core/types";

/**
 * Registry-lookup mock routes (ADR 0090) — deterministic ARES + VIES stand-ins so
 * mock-mode dev exercises the IČO-prefill / DIČ-badge UI without the public
 * registers. Magic inputs cover the non-happy branches: IČO `00000000` →
 * `not_found`; a DIČ ending in `0` → `invalid`. The real api fails soft; these
 * never error.
 */
export const lookupRoutes: MockRoute[] = [
  {
    method: "POST",
    pattern: "/v1/lookups/ares",
    handler: async ({ getBody }) => {
      const { ico = "" } = ((await getBody()) ?? {}) as { ico?: string };
      const result: AresLookup =
        ico === "00000000"
          ? { status: "not_found" }
          : {
              status: "found",
              ico,
              name: "Demo Stavby s.r.o.",
              dic: `CZ${ico}`,
              address: { line: "Dlouhá 1", city: "Praha", postalCode: "11000", country: "CZ" },
              dissolved: false,
            };
      return { data: result };
    },
  },
  {
    method: "POST",
    pattern: "/v1/lookups/vies",
    handler: async ({ getBody }) => {
      const { dic = "" } = ((await getBody()) ?? {}) as { dic?: string };
      const result: ViesLookup = dic.endsWith("0")
        ? { status: "invalid" }
        : { status: "valid", name: "Demo Stavby s.r.o.", address: "Dlouhá 1, 110 00 Praha" };
      return { data: result };
    },
  },
];
