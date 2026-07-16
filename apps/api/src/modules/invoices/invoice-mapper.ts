/**
 * The consumer-owned mapper (ADR 0112 §2/§4) — the ONE Perimetra-side seam
 * against the shared `@cardo/tax-cz` kernel. It turns the accepted quote's
 * ALREADY-FROZEN per-rate `TaxBreakdown` (ADR 0080) plus the supply-time
 * identity/dates/numbering into the kernel's ergonomic `BuildInvoiceInput`; the
 * caller then hands that to `buildInvoice`, which assembles the full
 * `ExportableDocument` (the seam boundary ADR 0018 pins — the kernel owns ALL
 * VAT derivation; the consumer never re-derives CZ tax).
 *
 * The mapper's SOLE numeric job is the koruna↔haléře reconciliation (ADR 0112
 * §2): Perimetra money is an I10 exact-decimal koruna string, the kernel is
 * integer-haléře native. `korunaToHalere` does the ×100 in EXACT decimal
 * (`mulMoney`, no float noise) and then rounds with the KERNEL's own
 * `roundHalfAwayFromZero` — so the seam never invents a second rounding rule.
 *
 * Only the per-rate GROSS crosses the seam (ADR 0112 §4): `buildInvoice`
 * re-derives base/VAT top-down (§37), so the printed net/VAT split is the
 * §37-correct one and need not equal the quote's bottom-up split (the Σgross
 * payable is identical). The §92e nuance is honoured: a reverse-charge line
 * keeps its 21/12 percent but takes its REGIME from the (frozen or overridden)
 * mode — `regime`, not `rate`, zeroes the line VAT and drives the legend.
 *
 * PURE: a total function of its inputs (no I/O, no clock, no throws on business
 * rules — §29 issuability is the caller's write-seam concern). Freezing its
 * output as `invoice.facts` makes a re-run of `buildInvoice` reproduce the
 * `snapshot` byte-for-byte (the ADR-0112 §6 harness).
 */
import { isDeepStrictEqual } from "node:util";
import {
  regimeForRate,
  roundHalfAwayFromZero,
  type DocumentPaymentMethod,
  type VatRegime,
} from "@cardo/tax-cz";
import {
  buildInvoice,
  type BuildInvoiceInput,
  type BuildInvoiceLineInput,
  type ExportableDocument,
} from "@cardo/tax-cz/export";

import { mulMoney, type MoneyString, type TaxBreakdown, type TaxModeKind } from "@repo/model";

/** Discrete + freetext address inputs (the supplier/buyer identity blocks).
 *  Not exported — consumers build an `InvoiceMapperInput` with inline literals. */
interface InvoiceParty {
  name: string;
  ico: string | null;
  dic: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

interface InvoiceSupplierParty extends InvoiceParty {
  bankAccount: string | null;
  iban: string | null;
}

interface InvoiceBuyerParty extends InvoiceParty {
  email: string | null;
}

export interface InvoiceMapperInput {
  invoiceId: string;
  documentNumber: string;
  issuedOn: string;
  duzp: string;
  dueOn: string;
  currency: string;
  /** The accepted quote's frozen per-rate tax document (ADR 0080). */
  tax: TaxBreakdown;
  /** Effective tax mode = `modeOverride ?? tax.mode` (§21; resolved by caller). */
  mode: TaxModeKind;
  /** Uniform per-line VAT-percent override (§21), or null to keep the frozen rates. */
  ratePctOverride: string | null;
  supplier: InvoiceSupplierParty;
  buyer: InvoiceBuyerParty;
  paymentMethod: DocumentPaymentMethod;
  /** Bank variabilní symbol, frozen (kernel-derived from the document number). */
  variableSymbol: string;
  /** Human basis label for line descriptions (the quote's evidenční číslo). */
  basisLabel: string;
  note: string | null;
}

/**
 * Convert an I10 koruna decimal string to integer haléře (the kernel's minor
 * unit). The ×100 is EXACT (BigInt decimal, no float accumulation), then the
 * kernel's half-away-from-zero rounding drops any sub-haléř remainder — the ONE
 * money-unit reconciliation the consumer owns (ADR 0112 §2). Sign-preserving.
 */
export function korunaToHalere(koruna: MoneyString): number {
  return roundHalfAwayFromZero(Number(mulMoney(koruna, "100")));
}

/** VAT regime for a line: §92e keeps its 21/12 percent but reads the regime
 *  from the mode (ADR 0112 §4); otherwise the kernel maps rate→regime. */
function regimeFor(mode: TaxModeKind, ratePct: number): VatRegime {
  return mode === "reverse_charge_92e" ? "reverse_charge" : regimeForRate(ratePct);
}

/** A §29-adequate freetext address ("street, PSČ city"), or "-" when unknown. */
function freetextAddress(p: InvoiceParty): string {
  const cityLine = [p.postalCode, p.city].filter((x) => x && x.trim()).join(" ");
  const parts = [p.addressLine, cityLine].filter((x) => x && x.trim());
  return parts.length ? parts.join(", ") : "-";
}

/** Build the kernel's `BuildInvoiceInput` from the mapped facts. */
export function buildInvoiceInputFrom(input: InvoiceMapperInput): BuildInvoiceInput {
  const multiRate = input.tax.lines.length > 1;
  const lines: BuildInvoiceLineInput[] = input.tax.lines.map((line): BuildInvoiceLineInput => {
    const ratePct = Number(input.ratePctOverride ?? line.ratePct);
    return {
      description: multiRate
        ? `Dodávka a montáž dle nabídky ${input.basisLabel} (${line.ratePct} %)`
        : `Dodávka a montáž dle nabídky ${input.basisLabel}`,
      quantity: 1,
      unit: "ks",
      grossCents: korunaToHalere(line.gross),
      vatRatePercent: ratePct,
      regime: regimeFor(input.mode, ratePct),
    };
  });

  return {
    id: input.invoiceId,
    number: input.documentNumber,
    type: "invoice",
    issueDate: input.issuedOn,
    duzpDate: input.duzp,
    dueDate: input.dueOn,
    supplier: {
      name: input.supplier.name,
      address: freetextAddress(input.supplier),
      ico: input.supplier.ico ?? "",
      dic: input.supplier.dic,
      bankAccount: input.supplier.bankAccount,
      iban: input.supplier.iban,
      street: input.supplier.addressLine,
      city: input.supplier.city,
      postalCode: input.supplier.postalCode,
      countryCode: input.supplier.country,
    },
    buyer: {
      name: input.buyer.name,
      address: freetextAddress(input.buyer),
      ico: input.buyer.ico,
      dic: input.buyer.dic,
      email: input.buyer.email,
      street: input.buyer.addressLine,
      city: input.buyer.city,
      postalCode: input.buyer.postalCode,
      countryCode: input.buyer.country,
    },
    lines,
    payment: {
      method: input.paymentMethod,
      variableSymbol: input.variableSymbol,
    },
    note: input.note,
  };
}

/** Map + build in one step (the caller freezes `facts` = the returned input's
 *  source and `snapshot` = `buildInvoice(facts)`). Kept separate so the service
 *  can freeze the exact `BuildInvoiceInput` it passes to `buildInvoice`. */
export function buildInvoiceDocument(input: InvoiceMapperInput): {
  facts: BuildInvoiceInput;
  snapshot: ExportableDocument;
} {
  const facts = buildInvoiceInputFrom(input);
  return { facts, snapshot: buildInvoice(facts) };
}

/**
 * The I3 reproducibility check (ADR 0112 §6): re-run `buildInvoice` over the
 * frozen `facts` and structurally compare against the frozen `snapshot`. Both
 * sides are normalized through JSON first so a fresh `undefined` optional (which
 * JSONB dropped at rest) can't spuriously diverge — the honest test is "does
 * re-serializing the rebuilt document equal the stored document". `facts`/
 * `snapshot` arrive as JSONB (`unknown`); the cast is the storage boundary.
 */
export function reproduceInvoice(
  facts: unknown,
  snapshot: unknown,
): { reproduced: boolean; mismatches: string[] } {
  const rebuilt = normalizeJson(buildInvoice(facts as BuildInvoiceInput)) as Record<
    string,
    unknown
  >;
  const stored = (snapshot ?? {}) as Record<string, unknown>;
  const mismatches: string[] = [];
  const keys = new Set([...Object.keys(rebuilt), ...Object.keys(stored)]);
  for (const key of keys) {
    if (!isDeepStrictEqual(rebuilt[key], stored[key])) mismatches.push(key);
  }
  return { reproduced: mismatches.length === 0, mismatches };
}

/** Drop `undefined`-valued keys the way a JSONB round-trip does. */
function normalizeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
