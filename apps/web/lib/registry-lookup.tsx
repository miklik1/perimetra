"use client";

import { useTranslations } from "@repo/i18n/web";
import { type AresLookup, type ViesLookup } from "@repo/validators";

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
