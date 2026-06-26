/**
 * CZ DPH / §92e tax model (ADR 0080) — the structured, re-derivable tax document
 * that replaces the vestigial `dphRate: string + reverseCharge: boolean` pair
 * (which produced no breakdown at all — a quote froze only its net total).
 *
 * Two things make a CZ daňový doklad legally correct, and both are STRUCTURE,
 * not a rate:
 *
 *  1. **Per-rate breakdown** — net base per VAT rate → VAT amount per rate →
 *     gross. (One rate today; the shape carries many so mixed-rate is a data
 *     change, not a code change.)
 *  2. **§92e reverse charge is a different DOCUMENT, not a 0 % rate** — when both
 *     parties are CZ VAT payers AND the supply is construction/assembly work, the
 *     supplier issues a document with NO VAT line and a MANDATORY legend ("daň
 *     odvede zákazník"); the customer self-assesses. Modelling it as `rate = 0`
 *     produces a confidently-wrong document — the headline risk this layer kills.
 *
 * Purity + I3: {@link deriveTaxBreakdown} is a pure function of (rate bases,
 * mode, rounding policy, currency). A quote freezes its {@link TaxBreakdown} in
 * the immutable snapshot; re-derivation recomputes it from the same stamped
 * inputs and must reproduce it byte-identically. The engine stays tax-free (the
 * established discipline) — tax is computed app-side over the engine's net
 * output, but deterministically, so it re-derives.
 *
 * **PROVISIONAL — accountant-gated (flagged in ADR 0080):** the exact §92e
 * conditions ({@link resolveTaxMode}), the mandatory legend wording
 * ({@link REVERSE_CHARGE_92E_LEGEND_CS}), and the rounding policy are a
 * non-blocking confirmation check. The STRUCTURE is correct; the CONSTANTS need
 * sign-off.
 */
import { addMoney, percentOf, roundMoney, type RoundingPolicy } from "./money.js";
import type { MoneyString } from "./schema.js";

export const TAX_MODES = ["standard_vat", "reverse_charge_92e"] as const;
/** Discriminator: standard VAT vs §92e reverse charge (a no-VAT-line document). */
export type TaxModeKind = (typeof TAX_MODES)[number];

/** The transaction facts that decide the tax mode (§92e is per-transaction, not
 *  per-price-table). The buyer's VAT status arrives with the customer entity
 *  (ADR 0082); until then the issue request supplies these. */
export interface TaxConditions {
  /** The fabricator (our org) is a registered CZ VAT payer. */
  supplierVatPayer: boolean;
  /** The customer (odběratel) is a registered CZ VAT payer. */
  customerVatPayer: boolean;
  /** The supply is construction/assembly work in §92e scope (CZ-CPA 41–43). */
  constructionAssembly: boolean;
}

/**
 * Resolve the tax mode from the transaction facts. **PROVISIONAL ruleset
 * (accountant-gated):** §92e reverse charge applies iff BOTH parties are CZ VAT
 * payers AND the supply is construction/assembly. The precise CZ-CPA scope and
 * any thresholds must be confirmed.
 */
export function resolveTaxMode(c: TaxConditions): TaxModeKind {
  return c.supplierVatPayer && c.customerVatPayer && c.constructionAssembly
    ? "reverse_charge_92e"
    : "standard_vat";
}

/** PROVISIONAL mandatory §92e legend (cs) — accountant-gated wording (ADR 0080). */
export const REVERSE_CHARGE_92E_LEGEND_CS =
  "Daň odvede zákazník — přenesená daňová povinnost podle § 92e zákona č. 235/2004 Sb., o dani z přidané hodnoty.";

/** A net base already aggregated for one VAT rate (the caller chose per-line vs
 *  end-of-invoice aggregation per the policy granularity, see the quote
 *  service). `ratePct` is the percent as a decimal string ("21", "12", "0"). */
export interface RateBase {
  ratePct: MoneyString;
  netBase: MoneyString;
}

/** One rate's line in the breakdown. For §92e `vatAmount` is "0" and `gross`
 *  equals `netBase` — the customer self-assesses. */
export interface TaxRateLine {
  ratePct: MoneyString;
  netBase: MoneyString;
  vatAmount: MoneyString;
  gross: MoneyString;
}

/** The frozen, re-derivable tax document (I3). Carries the rounding policy it
 *  was computed under so the document is self-describing. */
export interface TaxBreakdown {
  mode: TaxModeKind;
  /** Mandatory for §92e; absent for standard VAT. */
  legend?: string;
  currency: string;
  rounding: RoundingPolicy;
  /** Per-rate lines, sorted by `ratePct` descending (deterministic — I3). */
  lines: TaxRateLine[];
  netTotal: MoneyString;
  /** "0" for §92e (no VAT charged on this document). */
  vatTotal: MoneyString;
  /** Equals `netTotal` for §92e. */
  grossTotal: MoneyString;
}

/** Numeric value of a percent string for deterministic sorting. */
function ratePctValue(r: MoneyString): number {
  return Number(r);
}

/**
 * Compute the structured tax breakdown. Pure + deterministic → re-derivable
 * (I3). For `standard_vat`: VAT per rate = round(netBase × ratePct/100) under
 * the policy; gross = net + VAT. For `reverse_charge_92e`: NO VAT line — every
 * `vatAmount` is "0", gross = net, and a legend is required (the document tells
 * the customer to self-assess).
 */
export function deriveTaxBreakdown(
  rateBases: ReadonlyArray<RateBase>,
  mode: TaxModeKind,
  policy: RoundingPolicy,
  currency: string,
  legend: string = REVERSE_CHARGE_92E_LEGEND_CS,
): TaxBreakdown {
  const reverse = mode === "reverse_charge_92e";

  // Deterministic order (I3): by rate descending, then collapse duplicate rates.
  const byRate = new Map<string, MoneyString>();
  for (const { ratePct, netBase } of rateBases) {
    const existing = byRate.get(ratePct);
    byRate.set(ratePct, existing === undefined ? netBase : addMoney([existing, netBase]));
  }

  const lines: TaxRateLine[] = [...byRate.entries()]
    .map(([ratePct, netBase]): TaxRateLine => {
      const vatAmount = reverse ? "0" : roundMoney(percentOf(netBase, ratePct), policy);
      const gross = reverse ? netBase : addMoney([netBase, vatAmount]);
      return { ratePct, netBase, vatAmount, gross };
    })
    .sort((a, b) => ratePctValue(b.ratePct) - ratePctValue(a.ratePct));

  const netTotal = addMoney(lines.map((l) => l.netBase));
  const vatTotal = reverse ? "0" : addMoney(lines.map((l) => l.vatAmount));
  const grossTotal = reverse ? netTotal : addMoney(lines.map((l) => l.gross));

  return {
    mode,
    ...(reverse ? { legend } : {}),
    currency,
    rounding: policy,
    lines,
    netTotal,
    vatTotal,
    grossTotal,
  };
}
