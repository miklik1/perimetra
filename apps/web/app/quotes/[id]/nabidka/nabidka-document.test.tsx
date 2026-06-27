import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { type NabidkaDocument } from "@repo/renderers";

import { NabidkaDocumentView } from "./nabidka-document";

const STANDARD: NabidkaDocument = {
  documentNumber: "2026/0007",
  supplier: {
    name: "Perimetra Vrata s.r.o.",
    ico: "01234567",
    dic: "CZ01234567",
    addressLine: "Tovární 5",
    city: "Olomouc",
    postalCode: "779 00",
    bankAccount: "2000145399/2010",
    registrationNote: "Zapsáno v OR vedeném Krajským soudem v Ostravě, oddíl C.",
  },
  customer: {
    name: "Stavby Vrata s.r.o.",
    ico: "27074358",
    dic: "CZ27074358",
    addressLine: "Průmyslová 12",
    city: "Brno",
    postalCode: "61200",
  },
  currency: "CZK",
  instanceCount: 3,
  lines: [
    {
      componentCode: "GATE-FRAME",
      name: "Rám brány",
      unit: "ks",
      category: "material",
      quantity: 1,
      totalPriceMoney: "12345.6",
    },
  ],
  categories: [
    { key: "material", total: "12345.6" },
    { key: "accessory", total: "0" },
    { key: "manufacturing", total: "0" },
    { key: "installation", total: "0" },
  ],
  tax: {
    mode: "standard_vat",
    currency: "CZK",
    rounding: { scale: 2, mode: "half-up", granularity: "end-of-invoice" },
    lines: [{ ratePct: "21", netBase: "12345.6", vatAmount: "2592.58", gross: "14938.18" }],
    netTotal: "12345.6",
    vatTotal: "2592.58",
    grossTotal: "14938.18",
  },
  netTotal: "12345.6",
  vatTotal: "2592.58",
  grossTotal: "14938.18",
};

const REVERSE: NabidkaDocument = {
  ...STANDARD,
  documentNumber: "2026/0008",
  tax: {
    mode: "reverse_charge_92e",
    legend: "Daň odvede zákazník — přenesená daňová povinnost podle § 92e.",
    currency: "CZK",
    rounding: { scale: 2, mode: "half-up", granularity: "end-of-invoice" },
    lines: [{ ratePct: "21", netBase: "12345.6", vatAmount: "0", gross: "12345.6" }],
    netTotal: "12345.6",
    vatTotal: "0",
    grossTotal: "12345.6",
  },
  legend: "Daň odvede zákazník — přenesená daňová povinnost podle § 92e.",
  vatTotal: "0",
  grossTotal: "12345.6",
};

function renderDoc(doc: NabidkaDocument) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <NabidkaDocumentView doc={doc} backHref="/quotes/abc" />
    </I18nProvider>,
  );
}

describe("NabidkaDocumentView (print surface, ADR 0087)", () => {
  it("lays out header, buyer, line items and the standard-VAT tax document", () => {
    renderDoc(STANDARD);
    expect(screen.getByRole("heading", { level: 1, name: "Nabídka" })).toBeInTheDocument();
    expect(screen.getByText("2026/0007")).toBeInTheDocument();
    // The authed toolbar (ADR 0087, now a shared component, ADR 0089): the back
    // link resolves to backHref + the print button is present.
    expect(screen.getByRole("link", { name: /Nabídky/ })).toHaveAttribute("href", "/quotes/abc");
    expect(screen.getByRole("button", { name: "Tisk / Uložit PDF" })).toBeInTheDocument();
    // Buyer block (frozen identity, ADR 0086).
    expect(screen.getByText("Stavby Vrata s.r.o.")).toBeInTheDocument();
    expect(screen.getByText("Průmyslová 12")).toBeInTheDocument();
    // Line item.
    expect(screen.getByText("Rám brány")).toBeInTheDocument();
    // Standard VAT, no §92e legend.
    expect(screen.getByText("Standardní DPH")).toBeInTheDocument();
    // Gross total renders (14 938,18) — appears on the rate line and the total row.
    expect(screen.getAllByText((t) => t.includes("938")).length).toBeGreaterThan(0);
    // Supplier block is the frozen org legal profile (ADR 0088): name + bank account.
    expect(screen.getByText("Perimetra Vrata s.r.o.")).toBeInTheDocument();
    expect(screen.getByText((t) => t.includes("2000145399/2010"))).toBeInTheDocument();
  });

  it("falls back to the supplier placeholder for a legacy quote with no supplier", () => {
    renderDoc({ ...STANDARD, supplier: null });
    expect(screen.getByText("Doplňte profil firmy (IČO, DIČ, adresa)")).toBeInTheDocument();
  });

  it("renders the §92e mandatory legend and the reverse-charge label", () => {
    renderDoc(REVERSE);
    expect(screen.getByText("Přenesená daňová povinnost (§ 92e)")).toBeInTheDocument();
    expect(screen.getByText(/Daň odvede zákazník/)).toBeInTheDocument();
  });

  it("falls back to the no-customer notice when no buyer is attached", () => {
    renderDoc({ ...STANDARD, customer: null });
    expect(screen.getByText("Bez odběratele")).toBeInTheDocument();
  });
});
