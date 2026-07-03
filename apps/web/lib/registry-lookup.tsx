"use client";

import { type ApiClient } from "@repo/api";
import { useMutation, useQuery } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { lookupDicSchema, type AresLookup, type ViesLookup } from "@repo/validators";

import { createLookupsQueries } from "./lookups-queries";
import { toast } from "./toast";

/**
 * Shared registry-lookup helpers (ADR 0090) — the pure mapping/tone logic + the
 * VIES badge, reused by the customer create form and the supplier legal-profile
 * form. The mappers are pure (unit-tested); the badge is presentational.
 */

export interface AresPrefill {
  name: string;
  dic: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
}

/** Normalize an ARES result into prefillable fields — `null` unless `found`. */
export function aresPrefill(result: AresLookup): AresPrefill | null {
  if (result.status !== "found") return null;
  return {
    name: result.name ?? "",
    dic: result.dic ?? null,
    addressLine: result.address?.line ?? null,
    city: result.address?.city ?? null,
    postalCode: result.address?.postalCode ?? null,
    country: result.address?.country ?? "CZ",
  };
}

type ViesTone = "valid" | "invalid" | "unavailable";

/** The visible badge state — `null` when there is nothing to show yet. */
export function viesTone(
  result: ViesLookup | undefined,
  loading: boolean,
): ViesTone | "loading" | null {
  if (loading) return "loading";
  if (!result) return null;
  return result.status;
}

const TONE_CLASS: Record<ViesTone | "loading", string> = {
  loading: "text-muted-foreground border-border",
  valid: "text-emerald-700 border-emerald-300 bg-emerald-50",
  invalid: "text-destructive border-destructive/40 bg-destructive/5",
  unavailable: "text-muted-foreground border-border",
};

const TONE_LABEL: Record<
  ViesTone | "loading",
  "viesChecking" | "viesValid" | "viesInvalid" | "viesUnavailable"
> = {
  loading: "viesChecking",
  valid: "viesValid",
  invalid: "viesInvalid",
  unavailable: "viesUnavailable",
};

/** VIES validity pill. Renders nothing until a DIČ has been checked. */
export function ViesBadge({ result, loading }: { result?: ViesLookup; loading?: boolean }) {
  const t = useTranslations("lookup");
  const tone = viesTone(result, loading ?? false);
  if (!tone) return null;
  return (
    <span
      role="status"
      className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs ${TONE_CLASS[tone]}`}
    >
      {t(TONE_LABEL[tone])}
    </span>
  );
}

/**
 * IČO → ARES lookup, wired with the fail-soft toasts (ADR 0090): a `found`
 * result is handed to `apply` (the caller sets whichever fields it owns — the
 * issue panel's `useState` pair, an RHF `setValue` fan-out, …); `not_found` /
 * `unavailable` / a network error toast instead of calling `apply`; a
 * `dissolved` subject still prefills but ALSO warns. Extracted so the ares
 * mutation + its toast copy live in exactly one place across the customer
 * create form, the customer create/edit form, and the supplier legal-profile
 * form (CAR-23) — never re-wired per call site.
 */
export function useAresLookup(client: ApiClient, apply: (prefill: AresPrefill) => void) {
  const tLookup = useTranslations("lookup");
  const lookupsQueries = createLookupsQueries(client);
  return useMutation({
    ...lookupsQueries.ares(),
    onSuccess: (result) => {
      const prefill = aresPrefill(result);
      if (!prefill) {
        toast.error(tLookup(result.status === "not_found" ? "aresNotFound" : "aresUnavailable"));
        return;
      }
      apply(prefill);
      if (result.dissolved) toast.warning(tLookup("aresDissolved"));
    },
    onError: () => toast.error(tLookup("aresUnavailable")),
  });
}

/**
 * DIČ → VIES validity, reactive and gated on a well-formed DIČ (a malformed
 * value never fires the request) — feed `result`/`isFetching` straight into
 * `<ViesBadge>`. Same extraction rationale as `useAresLookup`.
 */
export function useViesLookup(client: ApiClient, dic: string) {
  const lookupsQueries = createLookupsQueries(client);
  return useQuery({
    ...lookupsQueries.vies(dic),
    enabled: lookupDicSchema.safeParse(dic).success,
  });
}
