import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError } from "@repo/api";
import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import type { NabidkaDocument } from "@repo/renderers";
import type { SharedNabidka } from "@repo/validators";

import { isSupersededConflict, resolvedStatusFrom, SharedNabidkaView } from "./shared-nabidka-view";

const DOC: NabidkaDocument = {
  documentNumber: "2026/0001",
  supplier: {
    name: "Perimetra Vrata s.r.o.",
    ico: "01234567",
    dic: "CZ01234567",
    addressLine: "Tovární 5",
    city: "Olomouc",
    postalCode: "779 00",
    bankAccount: "2000145399/2010",
    registrationNote: "Zapsáno v OR.",
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
      totalPriceMoney: "129891.5",
    },
  ],
  categories: [
    { key: "material", total: "129891.5" },
    { key: "accessory", total: "0" },
    { key: "manufacturing", total: "0" },
    { key: "installation", total: "0" },
  ],
  tax: {
    mode: "standard_vat",
    currency: "CZK",
    rounding: { scale: 2, mode: "half-up", granularity: "end-of-invoice" },
    lines: [{ ratePct: "21", netBase: "129891.5", vatAmount: "27277.22", gross: "157168.72" }],
    netTotal: "129891.5",
    vatTotal: "27277.22",
    grossTotal: "157168.72",
  },
  netTotal: "129891.5",
  vatTotal: "27277.22",
  grossTotal: "157168.72",
};

function renderView(
  initial: Omit<SharedNabidka, "superseded"> & { superseded?: boolean },
  token = "share-000000000001",
) {
  const withSuperseded: SharedNabidka = { superseded: false, ...initial };
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <SharedNabidkaView initial={withSuperseded} token={token} />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("SharedNabidkaView (buyer-facing public nabídka landing, ADR 0089 reversal)", () => {
  it("renders the branded landing and the accept/decline affordance when issued", () => {
    renderView({ document: DOC, status: "issued", validUntil: null });
    // The real document data — supplier + buyer + doc number, no PDF-twin.
    expect(screen.getByText("2026/0001")).toBeInTheDocument();
    expect(screen.getByText("Perimetra Vrata s.r.o.")).toBeInTheDocument();
    expect(screen.getByText("Stavby Vrata s.r.o.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Závazně objednat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Odmítnout nabídku" })).toBeInTheDocument();
    // The buyer surface has NO back-to-quote link (it would hit the auth wall).
    expect(screen.queryByRole("link", { name: /Nabídky/ })).not.toBeInTheDocument();
  });

  it("greets the buyer by the customer name off the real document", () => {
    renderView({ document: DOC, status: "issued", validUntil: null });
    expect(screen.getByText("Dobrý den, Stavby Vrata s.r.o.")).toBeInTheDocument();
  });

  it("declines via the shareToken and advances to the declined note", async () => {
    // token share-000000000002 is a seeded, issued mock quote → decline succeeds.
    renderView({ document: DOC, status: "issued", validUntil: null }, "share-000000000002");
    fireEvent.click(screen.getByRole("button", { name: "Odmítnout nabídku" }));
    expect(await screen.findByText("Nabídku jste odmítli.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odmítnout nabídku" })).not.toBeInTheDocument();
  });

  it("renders the no-customer notice when the document has no buyer", () => {
    renderView({ document: { ...DOC, customer: null }, status: "issued", validUntil: null });
    expect(screen.getByText("Bez odběratele")).toBeInTheDocument();
    // Falls back to the generic greeting — no customer name to personalize with.
    expect(screen.getByText("Dobrý den")).toBeInTheDocument();
  });

  it("surfaces the error banner (buttons stay) when resolution fails without a status", async () => {
    // token share-000000000003 is a seeded ACCEPTED quote → the mock 409s with no
    // status body, so onError shows the generic error and keeps the buttons.
    renderView({ document: DOC, status: "issued", validUntil: null }, "share-000000000003");
    fireEvent.click(screen.getByRole("button", { name: "Závazně objednat" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Akci se nepodařilo dokončit. Zkuste to prosím znovu.",
    );
    expect(screen.getByRole("button", { name: "Závazně objednat" })).toBeInTheDocument();
  });

  it("accepts via the shareToken and advances to the accepted note (no buttons)", async () => {
    // token share-000000000001 is a seeded, issued mock quote → accept succeeds.
    renderView({ document: DOC, status: "issued", validUntil: null });
    fireEvent.click(screen.getByRole("button", { name: "Závazně objednat" }));
    expect(await screen.findByText("Nabídku jste přijali. Děkujeme.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Závazně objednat" })).not.toBeInTheDocument();
  });

  it("shows the accepted note instead of buttons for an already-accepted quote", () => {
    renderView({ document: DOC, status: "accepted", validUntil: null });
    expect(screen.getByText("Nabídku jste přijali. Děkujeme.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Závazně objednat" })).not.toBeInTheDocument();
  });

  it("shows the expired note for a lapsed quote", () => {
    renderView({ document: DOC, status: "expired", validUntil: "2020-01-01T00:00:00.000Z" });
    expect(screen.getByText("Platnost této nabídky vypršela.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Závazně objednat" })).not.toBeInTheDocument();
  });
});

describe("superseded handling (ADR-O1/CAR-158) — the real gap this wave closes", () => {
  it("shows the superseded banner and hides the actions when already flagged superseded", () => {
    // `status` stays "issued" — supersession never rewrites it — so the ONLY
    // signal telling the buyer to stop is the `superseded` flag.
    renderView({ document: DOC, status: "issued", validUntil: null, superseded: true });
    expect(screen.getByText("Nabídka byla nahrazena")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Závazně objednat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odmítnout nabídku" })).not.toBeInTheDocument();
  });

  it("flips to the superseded banner when accept 409s quote_superseded (a resolve race)", async () => {
    // The page loaded with `superseded: false` (stale), but the mock's backing
    // fixture for this token is ALREADY superseded — modeling the buyer
    // clicking just after a rep revised the quote.
    renderView(
      { document: DOC, status: "issued", validUntil: null, superseded: false },
      "share-000000000005",
    );
    fireEvent.click(screen.getByRole("button", { name: "Závazně objednat" }));
    expect(await screen.findByText("Nabídka byla nahrazena")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Závazně objednat" })).not.toBeInTheDocument();
    // NOT the generic error banner — the specific 409 path pre-empts it.
    expect(
      screen.queryByText("Akci se nepodařilo dokončit. Zkuste to prosím znovu."),
    ).not.toBeInTheDocument();
  });
});

describe("resolvedStatusFrom (409-race status lift, ADR 0089)", () => {
  const conflict = (body: unknown) =>
    new ApiError({ kind: "http", status: 409, message: "conflict", body });

  it("lifts the quote status from a 409 conflict body", () => {
    expect(resolvedStatusFrom(conflict({ code: "quote_not_open", status: "accepted" }))).toBe(
      "accepted",
    );
    expect(resolvedStatusFrom(conflict({ status: "expired" }))).toBe("expired");
  });

  it("returns null when the 409 carries no usable status, on non-409s, and on plain errors", () => {
    expect(resolvedStatusFrom(conflict({ code: "quote_not_open" }))).toBeNull();
    expect(resolvedStatusFrom(conflict({ status: "bogus" }))).toBeNull();
    expect(
      resolvedStatusFrom(new ApiError({ kind: "http", status: 404, message: "x", body: {} })),
    ).toBeNull();
    expect(resolvedStatusFrom(new Error("boom"))).toBeNull();
  });
});

describe("isSupersededConflict (quote_superseded 409 detection, ADR-O1/CAR-158)", () => {
  it("detects the quote_superseded 409 by code — a body with no status field", () => {
    expect(
      isSupersededConflict(
        new ApiError({
          kind: "http",
          status: 409,
          message: "superseded",
          code: "quote_superseded",
          body: { code: "quote_superseded", message: "superseded" },
        }),
      ),
    ).toBe(true);
  });

  it("returns false for other 409s, non-409s, and plain errors", () => {
    expect(
      isSupersededConflict(
        new ApiError({ kind: "http", status: 409, message: "x", code: "quote_not_open", body: {} }),
      ),
    ).toBe(false);
    expect(
      isSupersededConflict(new ApiError({ kind: "http", status: 404, message: "x", body: {} })),
    ).toBe(false);
    expect(isSupersededConflict(new Error("boom"))).toBe(false);
  });
});
