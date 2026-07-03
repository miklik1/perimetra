import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { formatDate } from "@repo/utils";
import { type QuoteDetail } from "@repo/validators";

import { QuoteDetailView } from "./quote-detail";

// A standard-VAT quote whose id matches a seeded MSW quote, so the verify
// action resolves to reproduced:true.
const STANDARD: QuoteDetail = {
  id: "00000000-0000-7000-8000-000000000001",
  projectId: null,
  customerId: null,
  status: "issued",
  documentNumber: "2026/0001",
  currency: "CZK",
  total: "129891.5",
  validUntil: null,
  shareToken: "share-1",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  stamps: {
    releaseIds: { gate: "sliding-gate@1" },
    catalogVersions: { "sliding-gate@1": 2 },
    priceTableVersion: 2,
    overrideIds: [],
  },
  snapshot: {
    money: { total: "129891.5" },
    tax: {
      mode: "standard_vat",
      currency: "CZK",
      rounding: { scale: 2, mode: "half-up", granularity: "end-of-invoice" },
      lines: [{ ratePct: "21", netBase: "129891.5", vatAmount: "27277.22", gross: "157168.72" }],
      netTotal: "129891.5",
      vatTotal: "27277.22",
      grossTotal: "157168.72",
    },
  },
};

const REVERSE: QuoteDetail = {
  ...STANDARD,
  id: "00000000-0000-7000-8000-000000000002",
  documentNumber: "2026/0002",
  snapshot: {
    money: { total: "129891.5" },
    tax: {
      mode: "reverse_charge_92e",
      legend: "Daň odvede zákazník — přenesená daňová povinnost podle § 92e.",
      currency: "CZK",
      rounding: { scale: 2, mode: "half-up", granularity: "end-of-invoice" },
      lines: [{ ratePct: "21", netBase: "129891.5", vatAmount: "0", gross: "129891.5" }],
      netTotal: "129891.5",
      vatTotal: "0",
      grossTotal: "129891.5",
    },
  },
};

// CAR-16: draft has nothing to share yet; issued/expired do (ADR 0089's
// `/nabidka/:shareToken` public route). `status` here is already the
// READ-time effective status the api computes (`effectiveStatus`) — these
// fixtures never need a client-side clock.
const DRAFT: QuoteDetail = {
  ...STANDARD,
  id: "00000000-0000-7000-8000-000000000003",
  documentNumber: "2026/0003",
  status: "draft",
  shareToken: "share-3",
};

const ISSUED_WITH_VALIDITY: QuoteDetail = {
  ...STANDARD,
  id: "00000000-0000-7000-8000-000000000004",
  documentNumber: "2026/0004",
  shareToken: "share-4",
  validUntil: "2026-08-15T00:00:00.000Z",
};

const EXPIRED: QuoteDetail = {
  ...STANDARD,
  id: "00000000-0000-7000-8000-000000000005",
  documentNumber: "2026/0005",
  status: "expired",
  shareToken: "share-5",
  validUntil: "2026-01-01T00:00:00.000Z",
};

function renderView(quote: QuoteDetail) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <QuoteDetailView quote={quote} />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("QuoteDetailView", () => {
  it("renders the structured tax breakdown (standard 21 %)", () => {
    renderView(STANDARD);
    expect(screen.getByText("2026/0001")).toBeInTheDocument();
    expect(screen.getByText("21 %")).toBeInTheDocument();
    expect(screen.getByText("Standardní DPH")).toBeInTheDocument();
    // The gross (157168.72) shows on the rate line AND the totals row → >0.
    expect(
      screen.getAllByText((t) => t.includes("157") && t.includes("168")).length,
    ).toBeGreaterThan(0);
  });

  it("§92e shows the mandatory legend and no VAT amounts", () => {
    renderView(REVERSE);
    expect(screen.getByText("Přenesená daňová povinnost (§ 92e)")).toBeInTheDocument();
    expect(screen.getByText(/Daň odvede zákazník/)).toBeInTheDocument();
  });

  it("verifies reproducibility as a trust feature", async () => {
    renderView(STANDARD);
    fireEvent.click(screen.getByRole("button", { name: "Ověřit reprodukovatelnost" }));
    expect(await screen.findByText(/Reprodukováno přesně/)).toBeInTheDocument();
  });
});

describe("QuoteDetailView — buyer link (CAR-16)", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom ships no Clipboard API — stub the one method the copy affordance calls.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("issued: shows the absolute buyer URL and copies it", async () => {
    renderView(STANDARD);
    const expectedUrl = `${window.location.origin}/nabidka/${STANDARD.shareToken}`;

    expect(screen.getByText(expectedUrl)).toBeInTheDocument();
    // No validUntil on this fixture — the "no expiry" line, not a warning.
    expect(screen.getByText("Bez časového omezení")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Kopírovat odkaz" }));
    expect(await screen.findByText("Zkopírováno")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expectedUrl);
  });

  it("issued: displays the formatted validUntil date", () => {
    renderView(ISSUED_WITH_VALIDITY);
    const dateLabel = formatDate(ISSUED_WITH_VALIDITY.validUntil!, undefined, "cs");
    expect(screen.getByText((text) => text.includes(dateLabel))).toBeInTheDocument();
  });

  it("draft: shows no buyer link", () => {
    renderView(DRAFT);
    expect(screen.queryByText("Odkaz pro zákazníka")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kopírovat odkaz" })).not.toBeInTheDocument();
  });

  it("expired: still shows the link, plus an expired warning", () => {
    renderView(EXPIRED);
    const expectedUrl = `${window.location.origin}/nabidka/${EXPIRED.shareToken}`;

    expect(screen.getByText(expectedUrl)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Platnost nabídky vypršela/);
  });
});
