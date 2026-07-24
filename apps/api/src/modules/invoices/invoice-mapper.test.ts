/**
 * Mapper unit tests (ADR 0112) — the consumer-owned seam against `@cardo/tax-cz`.
 * Pure, no DB: proves the koruna→haléře reconciliation, the §92e regime nuance,
 * and that a freeze → re-run of `buildInvoice` reproduces the snapshot (§6).
 */
import { roundHalfAwayFromZero } from "@cardo/tax-cz";
import { describe, expect, it } from "vitest";

import { type TaxBreakdown } from "@repo/model";
import { roundingPolicySchema } from "@repo/validators/price-tables";

import {
  buildInvoiceDocument,
  buildInvoiceInputFrom,
  korunaToHalere,
  reproduceInvoice,
  type InvoiceMapperInput,
} from "./invoice-mapper.js";

const ROUNDING = { scale: 2, mode: "half-up", granularity: "end-of-invoice" } as const;

function standardTax(): TaxBreakdown {
  return {
    mode: "standard_vat",
    currency: "CZK",
    rounding: ROUNDING,
    lines: [{ ratePct: "21", netBase: "100000", vatAmount: "21000", gross: "121000" }],
    netTotal: "100000",
    vatTotal: "21000",
    grossTotal: "121000",
  };
}

function reverseChargeTax(): TaxBreakdown {
  return {
    mode: "reverse_charge_92e",
    legend: "Daň odvede zákazník",
    currency: "CZK",
    rounding: ROUNDING,
    lines: [{ ratePct: "21", netBase: "100000", vatAmount: "0", gross: "100000" }],
    netTotal: "100000",
    vatTotal: "0",
    grossTotal: "100000",
  };
}

function baseInput(tax: TaxBreakdown): InvoiceMapperInput {
  return {
    invoiceId: "01890a5d-ac96-774b-bcce-b302099a0001",
    documentNumber: "FV2026/0007",
    issuedOn: "2026-07-16",
    duzp: "2026-07-16",
    dueOn: "2026-07-30",
    currency: "CZK",
    tax,
    mode: tax.mode,
    ratePctOverride: null,
    supplier: {
      name: "Ploty s.r.o.",
      ico: "12345678",
      dic: "CZ12345678",
      addressLine: "Hlavní 123",
      city: "Praha",
      postalCode: "11000",
      country: "CZ",
      bankAccount: "19-2000145399/0800",
      iban: "CZ6508000000192000145399",
    },
    buyer: {
      name: "Odběratel a.s.",
      ico: "87654321",
      dic: "CZ87654321",
      email: "kup@example.cz",
      addressLine: "Vedlejší 5",
      city: "Brno",
      postalCode: "60200",
      country: "CZ",
    },
    paymentMethod: "bank_transfer",
    variableSymbol: "20260007",
    basisLabel: "2026/0042",
    note: null,
  };
}

/**
 * Exact reference implementation — BigInt only, no float anywhere. `korunaToHalere`
 * must agree with this for every value that can reach it (see the "float boundary"
 * suite below); any divergence IS the IEEE-754 hop misbehaving.
 */
function exactKorunaToHalere(koruna: string): number {
  const neg = koruna.startsWith("-");
  const body = neg ? koruna.slice(1) : koruna;
  const dot = body.indexOf(".");
  const digits = dot === -1 ? body : body.slice(0, dot) + body.slice(dot + 1);
  const scale = dot === -1 ? 0 : body.length - dot - 1;
  const coeff = BigInt(digits);
  // value × 100 = coeff / 10^(scale − 2); round the remainder half AWAY FROM ZERO
  // (the magnitude is unsigned here, so "away from zero" is just "up").
  const shift = scale - 2;
  let whole: bigint;
  if (shift <= 0) {
    whole = coeff * 10n ** BigInt(-shift);
  } else {
    const divisor = 10n ** BigInt(shift);
    const q = coeff / divisor;
    whole = (coeff % divisor) * 2n >= divisor ? q + 1n : q;
  }
  return neg ? -Number(whole) : Number(whole);
}

describe("korunaToHalere", () => {
  it("scales exact-decimal ×100 and rounds half away from zero", () => {
    expect(korunaToHalere("121000")).toBe(12100000);
    expect(korunaToHalere("129891.504")).toBe(12989150); // sub-haléř dropped
    expect(korunaToHalere("1.005")).toBe(101); // .5 haléř rounds AWAY from zero
    expect(korunaToHalere("0.004")).toBe(0);
    expect(korunaToHalere("0")).toBe(0);
  });

  it("delegates the rounding DECISION to the kernel's half-away-from-zero rule", () => {
    // The seam deliberately owns no rounding rule of its own (ADR 0112 §2 — the
    // kernel's `buildInvoice` contract requires exactly this delegation). 2.5 is
    // the tell: banker's rounding would say 2, matematické zaokrouhlení says 3.
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(korunaToHalere("0.025")).toBe(3); // 2.5 haléře, through the same rule
    expect(korunaToHalere("-0.025")).toBe(-3); // symmetric (credit-note direction)
  });
});

/**
 * The ONE deliberate IEEE-754 boundary in the module (`Number(mulMoney(...))`,
 * documented on `korunaToHalere`). These pin its PRECONDITION rather than the
 * happy path — if either half stops holding, the exception stops being bounded:
 *
 *  (1) at most 4 decimal places on the input, enforced upstream by the price
 *      table's `roundingPolicy.scale` cap — after the exact ×100 the value has
 *      at most 2 decimals, so it is an exact (binary-representable) `.5` tie or
 *      ≥ 0.01 away from one, far outside a double's error at CZK magnitudes;
 *  (2) an integer result far below 2^53.
 */
describe("korunaToHalere float boundary (the documented bounded exception)", () => {
  it("the ≤4-decimal precondition is ENFORCED upstream, not merely assumed", () => {
    // `korunaToHalere` only ever sees `TaxBreakdown` figures, and every one of
    // them is `roundMoney(..., policy)` at the price table's scale. Raising this
    // cap widens what reaches the float hop → this test is the tripwire.
    const base = { mode: "half-up", granularity: "end-of-invoice" } as const;
    expect(roundingPolicySchema.safeParse({ ...base, scale: 4 }).success).toBe(true);
    expect(roundingPolicySchema.safeParse({ ...base, scale: 5 }).success).toBe(false);
  });

  it("matches an exact BigInt reference on EVERY post-scaling fraction (0.00–0.99)", () => {
    // Worst case allowed by (1): 4 decimals, so ×100 leaves 2 — sweep all 100 of
    // them (k = 50 is the tie) across magnitudes from zero to far beyond any real
    // fence invoice. A float mis-decision anywhere would surface as a ±1 haléř.
    for (const whole of ["0", "1", "129891", "9999999", "999999999"]) {
      for (let k = 0; k < 100; k++) {
        const koruna = `${whole}.37${String(k).padStart(2, "0")}`;
        expect(korunaToHalere(koruna), koruna).toBe(exactKorunaToHalere(koruna));
      }
    }
  });

  it("is exact for >2-decimal inputs — the case a scale-3/4 price table produces", () => {
    // The claim "the input is already 2dp" is FALSE in general (a price table may
    // legitimately round to 3 or 4 places), so the sub-haléř tail must round, not
    // drift. Both sides of the tie, at a realistic magnitude.
    for (const koruna of ["129891.504", "129891.505", "1.0049", "1.005", "1.0051"]) {
      expect(korunaToHalere(koruna), koruna).toBe(exactKorunaToHalere(koruna));
    }
  });

  it("the EXACT ×100 is load-bearing — a naive float multiply mis-rounds the tie", () => {
    // Why `mulMoney` and not `Number(koruna) * 100`: the naive product lands just
    // BELOW the tie and rounds down, losing a haléř on a legal document.
    expect(Number("1.005") * 100).toBeLessThan(100.5);
    expect(roundHalfAwayFromZero(Number("1.005") * 100)).toBe(100); // the bug avoided
    expect(korunaToHalere("1.005")).toBe(101); // exact ×100 → a clean, exact tie
  });
});

describe("buildInvoiceInputFrom", () => {
  it("carries one line per rate group, gross-in-haléře, standard regime", () => {
    const input = buildInvoiceInputFrom(baseInput(standardTax()));
    expect(input.lines).toHaveLength(1);
    expect(input.lines[0]).toMatchObject({
      grossCents: 12100000,
      vatRatePercent: 21,
      regime: "standard",
      quantity: 1,
      unit: "ks",
    });
    expect(input.supplier.iban).toBe("CZ6508000000192000145399");
    expect(input.payment).toEqual({ method: "bank_transfer", variableSymbol: "20260007" });
  });

  it("§92e keeps the 21% rate but takes the reverse_charge REGIME from the mode", () => {
    const input = buildInvoiceInputFrom(baseInput(reverseChargeTax()));
    expect(input.lines[0]).toMatchObject({ vatRatePercent: 21, regime: "reverse_charge" });
  });

  it("applies a uniform rate override to the line percent", () => {
    const input = buildInvoiceInputFrom({ ...baseInput(standardTax()), ratePctOverride: "12" });
    expect(input.lines[0]).toMatchObject({ vatRatePercent: 12, regime: "reduced" });
  });
});

describe("buildInvoiceDocument", () => {
  it("standard VAT: kernel re-derives base/VAT top-down (§37) from the gross", () => {
    const { snapshot } = buildInvoiceDocument(baseInput(standardTax()));
    expect(snapshot.reverseCharge).toBe(false);
    expect(snapshot.totalCents).toBe(12100000);
    expect(snapshot.subtotalBaseCents).toBe(10000000); // 121000 / 1.21
    expect(snapshot.vatTotalCents).toBe(2100000);
    expect(snapshot.variableSymbol).toBe("20260007");
  });

  it("§92e: no output VAT, reverseCharge flag set, gross === base", () => {
    const { snapshot } = buildInvoiceDocument(baseInput(reverseChargeTax()));
    expect(snapshot.reverseCharge).toBe(true);
    expect(snapshot.vatTotalCents).toBe(0);
    expect(snapshot.subtotalBaseCents).toBe(10000000);
    expect(snapshot.totalCents).toBe(10000000);
  });
});

describe("reproduceInvoice (I3, §6)", () => {
  it("re-runs buildInvoice over frozen facts and reproduces the snapshot", () => {
    const { facts, snapshot } = buildInvoiceDocument(baseInput(standardTax()));
    // Simulate the JSONB round-trip the DB performs.
    const storedFacts = JSON.parse(JSON.stringify(facts));
    const storedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const result = reproduceInvoice(storedFacts, storedSnapshot);
    expect(result).toEqual({ reproduced: true, mismatches: [] });
  });

  it("names the diverging key when the stored snapshot was tampered with", () => {
    const { facts, snapshot } = buildInvoiceDocument(baseInput(standardTax()));
    const tampered = { ...JSON.parse(JSON.stringify(snapshot)), totalCents: 999 };
    const result = reproduceInvoice(JSON.parse(JSON.stringify(facts)), tampered);
    expect(result.reproduced).toBe(false);
    expect(result.mismatches).toContain("totalCents");
  });
});
