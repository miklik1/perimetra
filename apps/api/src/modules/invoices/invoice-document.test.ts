/**
 * The pure §29 document projection (ADR 0127) — no Nest, no DB, hand-written
 * `ExportableDocument` fixtures straight into `buildInvoiceDocumentView`.
 *
 * What this file exists to pin:
 *  - the kernel owns the labels and the money: `Daňový doklad`, `Bankovním
 *    převodem`, `21 %` and every `formatCents` string come OUT of
 *    `buildPdfViewModel` and are asserted verbatim, so a second web-side or
 *    api-side formatter would show up here as a diff;
 *  - FREEZE HONESTY: `supplierEmail` is `null` (there is no data source) and
 *    `issuingSystem` is the constant `Perimetra`;
 *  - the ISSUER LEAK TRIPWIRE: the four structurally-required-but-never-read
 *    `ExportableIssuer` placeholders must not reach the wire;
 *  - the §92e legend is the EXACT kernel string — the no-second-legend pin;
 *  - FAIL CLOSED: a malformed frozen payload returns `{ok:false}`, never a
 *    partial document, never a throw;
 *  - the refusal reason is a zod PATH, never buyer data.
 */
import { describe, expect, it } from "vitest";

import { buildInvoiceDocumentView } from "./invoice-document.js";

const BUYER_NAME = "Odběratel a.s.";

/** One 21% line, 121 000,00 CZK gross — the shape `invoice-mapper` freezes. */
function standardDocument(): Record<string, unknown> {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a0001",
    number: "FV2026/0001",
    type: "invoice",
    issueDate: "2026-07-16",
    duzpDate: "2026-07-16",
    dueDate: "2026-07-30",
    currency: "CZK",
    exchangeRate: null,
    foreignTotalCents: null,
    foreignVatSummary: null,
    reverseCharge: false,
    supplierName: "Ploty s.r.o.",
    supplierAddress: "Hlavní 123, 11000 Praha, CZ",
    supplierIco: "12345678",
    supplierDic: "CZ12345678",
    supplierBankAccount: "19-2000145399/0800",
    supplierIban: "CZ6508000000192000145399",
    supplierStreet: "Hlavní 123",
    supplierCity: "Praha",
    supplierPostalCode: "11000",
    supplierCountryCode: "CZ",
    buyerName: BUYER_NAME,
    buyerAddress: "Vedlejší 5, 60200 Brno, CZ",
    buyerIco: "87654321",
    buyerDic: "CZ87654321",
    buyerEmail: "kup@example.cz",
    buyerStreet: "Vedlejší 5",
    buyerCity: "Brno",
    buyerPostalCode: "60200",
    buyerCountryCode: "CZ",
    variableSymbol: "20260001",
    paymentMethod: "bank_transfer",
    subtotalBaseCents: 10000000,
    vatTotalCents: 2100000,
    roundingCents: 0,
    totalCents: 12100000,
    vatSummary: [
      {
        ratePercent: 21,
        regime: "standard",
        grossCents: 12100000,
        baseCents: 10000000,
        vatCents: 2100000,
      },
    ],
    lines: [
      {
        index: 1,
        description: "Posuvná brána 4000 mm",
        quantity: 1,
        unit: "ks",
        lineBaseCents: 10000000,
        lineVatCents: 2100000,
        lineGrossCents: 12100000,
        vatRatePercent: 21,
        regime: "standard",
        foreignBaseCents: null,
        foreignGrossCents: null,
        khSubjectCode: null,
      },
    ],
    correctsNumber: null,
    note: null,
  };
}

/** §92e přenesená daňová povinnost — no output VAT, the legend is mandatory. */
function reverseChargeDocument(): Record<string, unknown> {
  const doc = standardDocument();
  return {
    ...doc,
    reverseCharge: true,
    subtotalBaseCents: 12100000,
    vatTotalCents: 0,
    totalCents: 12100000,
    vatSummary: [
      {
        ratePercent: 21,
        regime: "reverse_charge",
        grossCents: 12100000,
        baseCents: 12100000,
        vatCents: 0,
      },
    ],
    lines: [
      {
        ...(doc.lines as Record<string, unknown>[])[0],
        lineBaseCents: 12100000,
        lineVatCents: 0,
        lineGrossCents: 12100000,
        regime: "reverse_charge",
      },
    ],
  };
}

function ok(snapshot: unknown) {
  const result = buildInvoiceDocumentView(snapshot);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.document;
}

describe("buildInvoiceDocumentView — the kernel owns every label and every number", () => {
  it("projects the frozen document through buildPdfViewModel verbatim", () => {
    const doc = ok(standardDocument());

    expect(doc.documentNumber).toBe("FV2026/0001");
    // Kernel-owned strings — never an i18n key, never a web-side map.
    expect(doc.documentTypeLabel).toBe("Daňový doklad");
    expect(doc.paymentMethod).toBe("Bankovním převodem");
    expect(doc.currency).toBe("CZK");

    // Kernel-owned money: formatCents, dot-decimal, two places, no grouping.
    expect(doc.totalAmount).toBe("121000.00");
    expect(doc.subtotalBase).toBe("100000.00");
    expect(doc.vatTotal).toBe("21000.00");

    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]!.vatRatePercent).toBe("21");
    expect(doc.vatRows[0]!.rateLabel).toBe("21 %");
  });

  it("FREEZE HONESTY: supplierEmail is absent and issuingSystem is the constant", () => {
    const doc = ok(standardDocument());
    // Not "must not be read live" — there IS no source (the legal profile has no
    // e-mail column). The sheet renders an absence, never a masked value.
    expect(doc.supplierEmail).toBeNull();
    expect(doc.issuingSystem).toBe("Perimetra");
  });

  it("ISSUER LEAK TRIPWIRE: the unread ExportableIssuer placeholders never reach the wire", () => {
    const result = buildInvoiceDocumentView(standardDocument());
    expect(JSON.stringify(result)).not.toContain("Perimetra:anonymous");
  });

  it("a domestic document carries no FX, no rounding and no correction reference", () => {
    const doc = ok(standardDocument());
    expect(doc.roundingAmount).toBeNull();
    expect(doc.exchangeRateLabel).toBeNull();
    expect(doc.subtotalBaseCzk).toBeNull();
    expect(doc.vatTotalCzk).toBeNull();
    expect(doc.totalCzk).toBeNull();
    expect(doc.correctsNumber).toBeNull();
  });

  it("§92e: zero output VAT and the EXACT kernel legend (no second legend path)", () => {
    const doc = ok(reverseChargeDocument());
    expect(doc.reverseCharge).toBe(true);
    expect(doc.reverseChargeLegend).toBe("daň odvede zákazník");
    expect(doc.vatTotal).toBe("0.00");
    for (const row of doc.vatRows) expect(row.vatAmount).toBe("0.00");
  });
});

describe("buildInvoiceDocumentView — fail CLOSED on an unreadable frozen payload", () => {
  it.each([
    ["null", null],
    ["an empty object", {}],
    ["a non-array lines", { ...standardDocument(), lines: "nope" }],
    ["a stringified total", { ...standardDocument(), totalCents: "121000" }],
  ])("refuses %s without throwing and without a partial document", (_label, snapshot) => {
    const result = buildInvoiceDocumentView(snapshot);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("document");
    if (!result.ok) expect(typeof result.reason).toBe("string");
  });

  it("the refusal reason is a zod PATH, never buyer data", () => {
    const result = buildInvoiceDocumentView({ ...standardDocument(), lines: "nope" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("lines");
    expect(result.reason).not.toContain(BUYER_NAME);
  });
});
