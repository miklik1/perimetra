import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { formatDate } from "@repo/utils";
import { QUOTE_STATUSES, type QuoteDetail } from "@repo/validators";

import { QuoteDetailView } from "./quote-detail";

// The ADR-0129 send affordance inside the buyer-link panel rides `useRole()`,
// which normally resolves asynchronously off the `/v1/me` probe. Mocking the
// hook makes the gate synchronous so these renders are deterministic — the
// `invoice-detail.test.tsx` idiom. Nothing else on this surface reads it.
let mockRole: string | null = "admin";
vi.mock("../../../lib/use-role", () => ({ useRole: () => mockRole }));

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
  revisionOfId: null,
  supersededById: null,
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

// CAR-16: every status a quote can hold has a shareable offer behind it (ADR
// 0089's `/nabidka/:shareToken` public route) — a quote is born `issued`, and
// ADR 0127 removed the unwritable `draft` that was the sole no-link case.
// `status` here is already the READ-time effective status the api computes
// (`effectiveStatus`) — these fixtures never need a client-side clock.
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

// A priced (admin/sales) snapshot carrying the aggregated site BOM (§3.2
// gap-fill) — mirrors the frozen `SiteBomLine[]` shape, per-line
// `totalPriceMoney` present because this fixture's `total` is non-null.
const STANDARD_WITH_BOM: QuoteDetail = {
  ...STANDARD,
  id: "00000000-0000-7000-8000-000000000006",
  documentNumber: "2026/0006",
  shareToken: "share-6",
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
    bom: [
      {
        componentCode: "AL-PRF-40",
        name: "Hliníkový profil 40x40",
        unit: "meter",
        category: "material",
        quantity: 12.5,
        totalPriceMoney: "4500.00",
        sources: [{ instanceId: "gate", path: "frame.profile" }],
      },
      {
        componentCode: "MOTOR-STD",
        name: "Pohon posuvné brány",
        unit: "piece",
        category: "manufacturing",
        quantity: 1,
        totalPriceMoney: "18900.00",
        sources: [{ instanceId: "gate", path: "drive.motor" }],
      },
    ],
  },
};

// The PRICE-BLIND workshop projection (mirrors `blindSnapshot`,
// `quotes.service.ts`): `total` is server-nulled, `tax`/`money` are absent
// entirely, and every BOM line carries NO `totalPriceMoney` — the exact wire
// shape a workshop viewer receives. Used to prove the belt-and-suspenders
// absence: no money ANYWHERE on this render, including the BOM.
const WORKSHOP_BLIND: QuoteDetail = {
  ...STANDARD,
  id: "00000000-0000-7000-8000-000000000007",
  documentNumber: "2026/0007",
  shareToken: "share-7",
  total: null,
  snapshot: {
    bom: [
      {
        componentCode: "AL-PRF-40",
        name: "Hliníkový profil 40x40",
        unit: "meter",
        category: "material",
        quantity: 12.5,
        sources: [{ instanceId: "gate", path: "frame.profile" }],
      },
    ],
  },
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
    // The document number now appears twice by design (the titleband H1 AND
    // the header meta's "Číslo nabídky" row, §3.2) — a single-match query would
    // throw, so this asserts presence, not uniqueness.
    expect(screen.getAllByText("2026/0001").length).toBeGreaterThan(0);
    expect(screen.getByText("21 %")).toBeInTheDocument();
    expect(screen.getByText("Standardní DPH")).toBeInTheDocument();
    // The panel is titled as what it IS — a VAT breakdown on an offer — and
    // NEVER as a §29 daňový doklad (ADR 0126): a nabídka has its own number
    // series, no DUZP, no payment block, and its VAT is derived bottom-up while
    // the invoice kernel is §37 top-down. Both halves asserted, because the
    // regression that matters is the old label creeping back.
    expect(screen.getByText("Rozpis DPH")).toBeInTheDocument();
    expect(screen.queryByText("Daňový doklad")).not.toBeInTheDocument();
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

  it("uses the text-success token for the reproduced-OK state (§12.2 no-raw-color)", async () => {
    renderView(STANDARD);
    fireEvent.click(screen.getByRole("button", { name: "Ověřit reprodukovatelnost" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Reprodukováno přesně");
    expect(status.className).toContain("text-success");
    expect(status.className).not.toContain("green-700");
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
    // No validUntil on this fixture — the "no expiry" line, not a warning. The
    // same phrase now also appears in the header meta's "Platnost do" row
    // (§3.2 validity gap-fill), so this asserts presence, not uniqueness.
    expect(screen.getAllByText("Bez časového omezení").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Kopírovat odkaz" }));
    expect(await screen.findByText("Zkopírováno")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expectedUrl);
  });

  it("issued: displays the formatted validUntil date", () => {
    renderView(ISSUED_WITH_VALIDITY);
    const dateLabel = formatDate(ISSUED_WITH_VALIDITY.validUntil!, undefined, "cs");
    // The date now shows in both the buyer-link panel AND the header meta's
    // "Platnost do" row (§3.2 validity gap-fill) — assert at least one match.
    expect(screen.getAllByText((text) => text.includes(dateLabel)).length).toBeGreaterThan(0);
  });

  // ADR 0127: the panel was guarded on `status !== "draft"` until that provably
  // unwritable status was removed; the guard is now unconditional. This pins the
  // removal — EVERY status the contract can carry must show a working link, so a
  // future status that genuinely has nothing to share fails here deliberately.
  it.each(QUOTE_STATUSES)("%s: shows the buyer link (no status is link-less)", (status) => {
    renderView({ ...STANDARD, status });
    expect(
      screen.getByText(`${window.location.origin}/nabidka/${STANDARD.shareToken}`),
    ).toBeInTheDocument();
  });

  it("expired: still shows the link, plus an expired warning", () => {
    renderView(EXPIRED);
    const expectedUrl = `${window.location.origin}/nabidka/${EXPIRED.shareToken}`;

    expect(screen.getByText(expectedUrl)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Platnost nabídky vypršela/);
  });
});

describe("QuoteDetailView — delivery (ADR 0129)", () => {
  afterEach(() => {
    mockRole = "admin";
  });

  it("the send action rides the buyer-link panel and leaves the copy affordance intact", async () => {
    renderView(STANDARD);
    // One panel about getting this offer to the buyer, not two: the manual copy
    // affordance and the automated send sit together, under the same heading.
    const panel = screen.getByText("Kopírovat odkaz").closest("[data-slot='panel']");
    expect(panel).not.toBeNull();
    expect(await screen.findByRole("button", { name: "Odeslat e-mailem" })).toBeInTheDocument();
    expect(panel).toContainElement(screen.getByRole("button", { name: "Odeslat e-mailem" }));
    // The explainer promises exactly what the mail does — a LINK to this
    // nabídka, which the ADR-0089 landing genuinely delivers.
    expect(panel).toHaveTextContent("Odběrateli přijde e-mail s odkazem na tuto nabídku.");
    // The positive control for the workshop assertion below: the separator IS
    // drawn when there is something under it, so that test cannot pass merely
    // because the class was renamed.
    expect(panel?.querySelector(".border-t")).not.toBeNull();
  });

  // Every status a quote can hold has a shareable offer behind it, so every one
  // of them is sendable — the send action inherits the buyer link's rule rather
  // than inventing a second one client-side. A superseded document is refused by
  // the SERVER with a typed 409, never pre-empted here.
  it.each(QUOTE_STATUSES)("%s: carries the send action", async (status) => {
    renderView({ ...STANDARD, status });
    expect(await screen.findByRole("button", { name: "Odeslat e-mailem" })).toBeInTheDocument();
  });

  it("workshop: no send affordance and no promise of one", () => {
    mockRole = "workshop";
    renderView(WORKSHOP_BLIND);
    expect(screen.queryByRole("button", { name: "Odeslat e-mailem" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Odběrateli přijde e-mail/)).not.toBeInTheDocument();
    // The buyer link itself stays — it is not a commercial-document transmission.
    expect(screen.getByRole("button", { name: "Kopírovat odkaz" })).toBeInTheDocument();
    // …and NO chrome is drawn around the absent action: the panel must not emit
    // its hairline divider (plus ~44px of padding) over nothing. Asserting the
    // button is gone does not catch this — a wrapper whose only child rendered
    // `null` is still in the DOM.
    const panel = screen
      .getByRole("button", { name: "Kopírovat odkaz" })
      .closest("[data-slot='panel']");
    expect(panel).not.toBeNull();
    expect(panel?.querySelector(".border-t")).toBeNull();
  });
});

describe("QuoteDetailView — revision lineage (§3.2, ADR-O1/CAR-158)", () => {
  it("supersededById shows a superseded notice linking to the newer revision by id", () => {
    renderView({ ...STANDARD, supersededById: "00000000-0000-7000-8000-0000000000aa" });
    expect(screen.getByText("Nahrazeno novější revizí")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Zobrazit novější revizi" });
    expect(link).toHaveAttribute("href", "/quotes/00000000-0000-7000-8000-0000000000aa");
  });

  it("revisionOfId shows a revision notice linking to the original by id", () => {
    renderView({ ...STANDARD, revisionOfId: "00000000-0000-7000-8000-0000000000bb" });
    expect(screen.getByText("Revize předchozí nabídky")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Zobrazit původní nabídku" });
    expect(link).toHaveAttribute("href", "/quotes/00000000-0000-7000-8000-0000000000bb");
  });

  it("neither lineage panel renders when both ids are null", () => {
    renderView(STANDARD);
    expect(screen.queryByText("Nahrazeno novější revizí")).not.toBeInTheDocument();
    expect(screen.queryByText("Revize předchozí nabídky")).not.toBeInTheDocument();
  });
});

describe("QuoteDetailView — aggregated site BOM (§3.2 gap-fill)", () => {
  it("priced (admin/sales): renders item, category, quantity, provenance, and price", () => {
    renderView(STANDARD_WITH_BOM);
    expect(screen.getByText("Rozpis položek nabídky")).toBeInTheDocument();
    expect(screen.getByText("Hliníkový profil 40x40")).toBeInTheDocument();
    expect(screen.getByText("AL-PRF-40")).toBeInTheDocument();
    // Per-instance provenance (the raw site-author instanceId) — both BOM
    // lines share the same "gate" instance in this fixture.
    expect(screen.getAllByText("gate").length).toBe(2);
    // The Cena column renders — total !== null on this fixture.
    expect(screen.getByText("Cena bez DPH")).toBeInTheDocument();
    expect(
      screen.getByText((text) => text.includes("4") && text.includes("500")),
    ).toBeInTheDocument();
  });

  it("price-blind (workshop): shows BOM quantities/provenance but NO money anywhere, including the BOM", () => {
    const { container } = renderView(WORKSHOP_BLIND);
    expect(screen.getByText("Rozpis položek nabídky")).toBeInTheDocument();
    expect(screen.getByText("Hliníkový profil 40x40")).toBeInTheDocument();
    expect(screen.getByText("AL-PRF-40")).toBeInTheDocument();
    // The Cena column header itself is absent — not just its cells.
    expect(screen.queryByText("Cena bez DPH")).not.toBeInTheDocument();
    // No §92e/DPH breakdown either (blindSnapshot drops `tax`).
    expect(screen.queryByText("Rozpis DPH")).not.toBeInTheDocument();
    // Belt-and-suspenders: no currency symbol anywhere on the page.
    expect(container.textContent).not.toMatch(/Kč/);
  });

  it("a snapshot without `bom` (pre-slice / mock) omits the section entirely", () => {
    renderView(STANDARD);
    expect(screen.queryByText("Rozpis položek nabídky")).not.toBeInTheDocument();
  });
});
