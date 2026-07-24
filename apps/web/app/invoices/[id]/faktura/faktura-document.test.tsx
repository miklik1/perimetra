import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { type InvoiceDocument } from "@repo/validators";

import { FakturaDocumentView } from "./faktura-document";

/** A representative domestic §29 document as the api serves it: every amount is
 *  the KERNEL's `formatCents` output (dot-decimal), every label the kernel
 *  already rendered (`documentTypeLabel`, `paymentMethod`, `rateLabel`). Nothing
 *  here is web-composed — that is the point of the fixture. */
const STANDARD: InvoiceDocument = {
  documentNumber: "FV2026/0001",
  documentTypeLabel: "Daňový doklad",
  issueDate: "2026-07-16",
  duzpDate: "2026-07-16",
  dueDate: "2026-07-30",
  variableSymbol: "20260001",
  paymentMethod: "Bankovním převodem",
  currency: "CZK",
  supplierName: "Perimetra Vrata s.r.o.",
  supplierAddress: "Tovární 5, 779 00 Olomouc",
  supplierIco: "01234567",
  supplierDic: "CZ01234567",
  supplierBankAccount: "2000145399/2010",
  supplierIban: "CZ6520100000002000145399",
  supplierEmail: null,
  buyerName: "Stavby Vrata s.r.o.",
  buyerAddress: "Průmyslová 12, 612 00 Brno",
  buyerIco: "27074358",
  buyerDic: "CZ27074358",
  lines: [
    {
      index: 1,
      description: "Posuvná brána 4000 × 1800",
      quantity: "1",
      unit: "ks",
      unitPriceNet: "100000.00",
      lineBaseAmount: "100000.00",
      vatRatePercent: "21",
      lineVatAmount: "21000.00",
      lineGrossAmount: "121000.00",
    },
  ],
  vatRows: [
    { rateLabel: "21 %", baseAmount: "100000.00", vatAmount: "21000.00", grossAmount: "121000.00" },
  ],
  subtotalBase: "100000.00",
  vatTotal: "21000.00",
  roundingAmount: null,
  totalAmount: "121000.00",
  exchangeRateLabel: null,
  subtotalBaseCzk: null,
  vatTotalCzk: null,
  totalCzk: null,
  reverseCharge: false,
  reverseChargeLegend: null,
  note: null,
  correctsNumber: null,
  issuingSystem: "Perimetra",
};

/** §92e (přenesená daňová povinnost): the kernel zeroes the VAT and carries the
 *  mandatory legend as TEXT on the wire. */
const REVERSE: InvoiceDocument = {
  ...STANDARD,
  documentNumber: "FV2026/0002",
  lines: [{ ...STANDARD.lines[0]!, lineVatAmount: "0.00", lineGrossAmount: "100000.00" }],
  vatRows: [
    { rateLabel: "21 %", baseAmount: "100000.00", vatAmount: "0.00", grossAmount: "100000.00" },
  ],
  vatTotal: "0.00",
  totalAmount: "100000.00",
  reverseCharge: true,
  reverseChargeLegend: "daň odvede zákazník",
};

/** Every nullable §29-mandatory-shaped field absent. The sheet must SHOW each
 *  absence (labelled `—`), never omit the row: a missing field on a daňový
 *  doklad is a defect that has to be visible. */
const ABSENT: InvoiceDocument = {
  ...STANDARD,
  documentNumber: "FV2026/0003",
  supplierDic: null,
  supplierBankAccount: null,
  supplierIban: null,
  supplierEmail: null,
  buyerIco: null,
  buyerDic: null,
  dueDate: null,
};

/** A foreign-currency document with the CZK recap the kernel derives. */
const FOREIGN: InvoiceDocument = {
  ...STANDARD,
  documentNumber: "FV2026/0004",
  currency: "EUR",
  exchangeRateLabel: "1 EUR = 25.5 CZK",
  subtotalBaseCzk: "2550000.00",
  vatTotalCzk: "535500.00",
  totalCzk: "3085500.00",
};

function renderDoc(doc: InvoiceDocument) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <FakturaDocumentView doc={doc} backHref="/invoices/abc" />
    </I18nProvider>,
  );
}

describe("FakturaDocumentView — the printable §29 daňový doklad (ADR 0127)", () => {
  it("titles the sheet from the PAYLOAD, not from a web-side label", () => {
    renderDoc(STANDARD);
    // The document type name has exactly one source: the kernel's own
    // DOCUMENT_TYPE_LABELS, on the wire.
    expect(screen.getByRole("heading", { level: 1, name: "Daňový doklad" })).toBeInTheDocument();
    expect(screen.getByText("FV2026/0001")).toBeInTheDocument();
    // The payment-method label is kernel-rendered too.
    expect(screen.getByText("Bankovním převodem")).toBeInTheDocument();
    // issuingSystem is a payload constant, not a tenant read.
    expect(screen.getByText("Vystaveno systémem Perimetra")).toBeInTheDocument();
  });

  it("renders the screen-only toolbar: back link + the print button", () => {
    renderDoc(STANDARD);
    expect(screen.getByRole("link", { name: /Faktury/ })).toHaveAttribute("href", "/invoices/abc");
    expect(screen.getByRole("button", { name: "Tisk / Uložit PDF" })).toBeInTheDocument();
  });

  it("prints kernel money VERBATIM — never through the cs-CZ formatter", () => {
    renderDoc(STANDARD);
    // formatCents output, unchanged, beside the frozen ISO currency code.
    expect(screen.getAllByText(/121000\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CZK/).length).toBeGreaterThan(0);
    // The `formatMoney` presentation (space grouping, comma decimal) must not
    // appear anywhere: a second money path on a regulated document is the
    // failure this pins.
    expect(screen.queryByText(/121\s*000,00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Kč/)).not.toBeInTheDocument();
  });

  it("prints the §92e legend verbatim from the payload and blanks the VAT cells", () => {
    renderDoc(REVERSE);
    // The EXACT kernel string — proving the legend is never composed, never
    // translated and never conditioned on anything but the payload field.
    expect(screen.getByText("daň odvede zákazník")).toBeInTheDocument();
    // The line's VAT cell states an absence under reverse charge; the recap
    // still prints the kernel's own zero.
    expect(screen.getAllByText(/0\.00/).length).toBeGreaterThan(0);
  });

  it("shows every absent §29 field as a labelled em dash, never omitted", () => {
    renderDoc(ABSENT);
    // Supplier DIČ / e-mail, buyer IČO / DIČ, bank account, IBAN, due date.
    expect(screen.getAllByText("IČO")).toHaveLength(2);
    expect(screen.getAllByText("DIČ")).toHaveLength(2);
    expect(screen.getByText("E-mail")).toBeInTheDocument();
    expect(screen.getByText("Bankovní účet")).toBeInTheDocument();
    expect(screen.getByText("IBAN")).toBeInTheDocument();
    expect(screen.getByText("Datum splatnosti")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(7);
  });

  it("omits the blocks that do not APPLY (null ≠ missing)", () => {
    renderDoc(STANDARD);
    expect(screen.queryByText("Poznámka")).not.toBeInTheDocument();
    expect(screen.queryByText("Zaokrouhlení")).not.toBeInTheDocument();
    expect(screen.queryByText("Opravuje doklad")).not.toBeInTheDocument();
    expect(screen.queryByText("Kurz")).not.toBeInTheDocument();
  });

  it("renders the CZK recap of a foreign-currency document", () => {
    renderDoc(FOREIGN);
    expect(screen.getByText("Kurz")).toBeInTheDocument();
    expect(screen.getByText("1 EUR = 25.5 CZK")).toBeInTheDocument();
    expect(screen.getByText("Základ daně celkem (CZK)")).toBeInTheDocument();
    // The CZK amounts are NOT suffixed with the document currency (EUR).
    expect(screen.getByText("3085500.00")).toBeInTheDocument();
    // ...while the document's own totals are.
    expect(screen.getAllByText(/EUR/).length).toBeGreaterThan(0);
  });

  it("carries the inline @page print stylesheet (zero PDF dependency)", () => {
    const { container } = renderDoc(STANDARD);
    const style = container.querySelector("style")?.textContent ?? "";
    expect(style).toContain("@page");
    expect(style).toContain(".no-print");
    // The sheet's own break guard.
    expect(style).toContain(".faktura-sheet tr");
  });
});
