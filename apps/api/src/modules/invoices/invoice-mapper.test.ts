/**
 * Mapper unit tests (ADR 0112) — the consumer-owned seam against `@cardo/tax-cz`.
 * Pure, no DB: proves the koruna→haléře reconciliation, the §92e regime nuance,
 * and that a freeze → re-run of `buildInvoice` reproduces the snapshot (§6).
 */
import { roundHalfAwayFromZero } from "@cardo/tax-cz";
import { describe, expect, it } from "vitest";

import { type TaxBreakdown } from "@repo/model";

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

describe("korunaToHalere", () => {
  it("scales exact-decimal ×100 and rounds half away from zero", () => {
    expect(korunaToHalere("121000")).toBe(12100000);
    expect(korunaToHalere("129891.504")).toBe(12989150); // sub-haléř dropped
    expect(korunaToHalere("1.005")).toBe(101); // .5 haléř rounds AWAY from zero
    expect(korunaToHalere("0.004")).toBe(0);
    expect(korunaToHalere("0")).toBe(0);
  });

  it("agrees with the kernel's own rounding on the scaled value", () => {
    for (const m of ["0.005", "12989150.4", "50.505", "999999.995"]) {
      // The exact ×100 avoids float noise; the DECISION is the kernel's.
      expect(korunaToHalere(m)).toBe(roundHalfAwayFromZero(Number(m) * 100));
    }
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
