import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { type Invoice } from "@repo/validators";

import { InvoiceDetailView } from "./invoice-detail";

// The payment affordance rides `useRole()`, which normally reads the real
// `/v1/me` probe (mocked in vitest.setup.ts as `role: "admin"`). Mocking the
// hook directly is the narrowest lever for exercising the sales / unresolved
// branches — the same idiom `orders-list.test.tsx` uses. Default `"admin"` so
// the payment buttons render unless a test says otherwise.
let mockRole: string | null = "admin";
vi.mock("../../../lib/use-role", () => ({ useRole: () => mockRole }));

// ids match the seeded MSW invoices (`fixtures/invoices.ts`) so the verify
// action resolves against a real mocked route rather than a 404.
const ISSUED: Invoice = {
  id: "01930000-0000-7000-8000-000000000001",
  orderId: "01920000-0000-7000-8000-000000000001",
  documentNumber: "FV2026/0001",
  status: "issued",
  currency: "CZK",
  issuedOn: "2026-07-16",
  duzp: "2026-07-16",
  dueOn: "2026-07-30",
  variableSymbol: "20260001",
  total: "121000.00",
  supersededById: null,
  paidAt: null,
  paidNote: null,
  createdAt: "2026-07-16T08:00:00.000Z",
  updatedAt: "2026-07-16T08:00:00.000Z",
  // Left absent ON PURPOSE: this surface renders ROW state only and must never
  // reach into the frozen document (that is the print sheet's data, served
  // pre-projected by GET /v1/invoices/:id/document). A fixture without it is
  // the cheapest structural pin on that boundary.
  snapshot: undefined,
};

const PAID: Invoice = {
  ...ISSUED,
  id: "01930000-0000-7000-8000-000000000002",
  documentNumber: "FV2026/0002",
  status: "paid",
  total: "48400.00",
  paidAt: "2026-07-22T10:15:00.000Z",
  paidNote: "VS 20260002",
};

const SUPERSEDED: Invoice = {
  ...ISSUED,
  id: "01930000-0000-7000-8000-000000000003",
  documentNumber: "FV2026/0003",
  supersededById: "01930000-0000-7000-8000-000000000009",
};

function renderView(invoice: Invoice) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <InvoiceDetailView invoice={invoice} />
      </ApiProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  mockRole = "admin";
});

describe("InvoiceDetailView", () => {
  it("issued: titleband, the print link and the payable total", () => {
    renderView(ISSUED);
    // The number appears twice by design (the H1 AND the "Číslo dokladu" row).
    expect(screen.getAllByText("FV2026/0001").length).toBeGreaterThan(0);
    expect(screen.getByText("Vydaná faktura")).toBeInTheDocument();

    // The §29 sheet lives at the /faktura print sub-route (chromeless).
    expect(screen.getByRole("link", { name: "Otevřít doklad (tisk / PDF)" })).toHaveAttribute(
      "href",
      `/invoices/${ISSUED.id}/faktura`,
    );

    // Row money (the I10 decimal koruna string) renders through `formatMoney`,
    // cs-CZ — the frozen document's kernel `formatCents` strings never appear
    // on this screen (they are the print sheet's business).
    expect(screen.getByText((text) => text.includes("Kč"))).toBeInTheDocument();

    // Frozen DOCUMENT content is deliberately absent here — one money formatter
    // per screen (§3.4). The VAT recapitulation is the sheet's heading.
    expect(screen.queryByText("Rekapitulace DPH")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Označit jako zaplacenou" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Zrušit označení úhrady" }),
    ).not.toBeInTheDocument();
  });

  it("paid: shows the settled row state and only the undo action", () => {
    renderView(PAID);
    // "Zaplaceno" is both the status badge and the KeyValueList key — assert on
    // the description-list term so the badge can't satisfy this by accident.
    const paidKey = screen.getAllByText("Zaplaceno").find((node) => node.tagName === "DT");
    expect(paidKey).toBeDefined();
    expect(screen.getByText("VS 20260002")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Zrušit označení úhrady" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Označit jako zaplacenou" }),
    ).not.toBeInTheDocument();
  });

  it("marks an issued invoice paid through the api and reflects the returned row", async () => {
    renderView(ISSUED);
    fireEvent.change(screen.getByLabelText("Poznámka k úhradě"), {
      target: { value: "VS 20260001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Označit jako zaplacenou" }));
    // The mutation resolves against the mocked POST /v1/invoices/:id/mark-paid;
    // the button returns to its idle label once it settles.
    expect(await screen.findByRole("button", { name: "Označit jako zaplacenou" })).toBeEnabled();
  });
});

describe("InvoiceDetailView — payment is admin-only (fail-closed)", () => {
  it("sales: no payment buttons, and the reason is stated", () => {
    mockRole = "sales";
    renderView(ISSUED);
    expect(screen.getByText("Úhradu může potvrdit jen administrátor.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Označit jako zaplacenou" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Zrušit označení úhrady" }),
    ).not.toBeInTheDocument();
  });

  it("unresolved role: the same closed state, never an optimistic affordance", () => {
    mockRole = null;
    renderView(PAID);
    expect(screen.getByText("Úhradu může potvrdit jen administrátor.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Zrušit označení úhrady" }),
    ).not.toBeInTheDocument();
    // Row state stays READABLE for everyone — only the transition is gated.
    expect(screen.getByText("VS 20260002")).toBeInTheDocument();
  });
});

describe("InvoiceDetailView — lineage", () => {
  it("supersededById shows the notice and links to the newer document by id", () => {
    renderView(SUPERSEDED);
    expect(screen.getByText("Nahrazeno novějším dokladem")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobrazit novější doklad" })).toHaveAttribute(
      "href",
      "/invoices/01930000-0000-7000-8000-000000000009",
    );
  });

  it("no lineage pointer renders no notice", () => {
    renderView(ISSUED);
    expect(screen.queryByText("Nahrazeno novějším dokladem")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailView — I3 trust", () => {
  it("verifies reproducibility and reports it with the success TOKEN, not a raw color", async () => {
    renderView(ISSUED);
    fireEvent.click(screen.getByRole("button", { name: "Ověřit reprodukovatelnost" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Reprodukováno přesně");
    expect(status.className).toContain("text-success");
    expect(status.className).not.toContain("green-700");
  });
});
