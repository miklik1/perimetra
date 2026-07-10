import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { type QuoteProduction } from "@repo/validators";

import { TravelerDocument } from "./traveler-document";

/** A representative post-slice production payload: one instance with the derived
 *  technical drawing + spec/dimension rows, and a BOM spanning two categories so
 *  the web-side grouping is exercised. Never carries money — the schema forbids it. */
const PRODUCTION: QuoteProduction = {
  id: "00000000-0000-7000-8000-000000000001",
  documentNumber: "2026/0042",
  status: "issued",
  createdAt: "2026-06-01T00:00:00.000Z",
  instances: [{ instanceId: "gate", releaseId: "sliding-gate@1" }],
  bom: [
    {
      componentCode: "POST",
      name: "Sloupek",
      unit: "ks",
      category: "material",
      quantity: 2,
      sources: [{ instanceId: "gate", path: "posts[0]" }],
    },
    {
      componentCode: "PROFILE",
      name: "Profil",
      unit: "m",
      category: "material",
      quantity: 6,
      sources: [{ instanceId: "gate", path: "frame" }],
    },
    {
      componentCode: "ROLLER",
      name: "Kladka",
      unit: "ks",
      category: "accessory",
      quantity: 4,
      sources: [{ instanceId: "gate", path: "rollers" }],
    },
  ],
  cutList: {
    components: [
      {
        componentCode: "POST",
        name: "Sloupek",
        lines: [{ componentCode: "POST", name: "Sloupek", lengthMm: 2100, count: 2, sources: [] }],
        totalPieces: 2,
        totalLengthMm: 4200,
      },
    ],
  },
  cutOptions: { kerfMm: 3 },
  drawings: {
    site: { instances: [], connections: [], terrain: [] },
    instances: {},
  },
  technicalDrawings: {
    gate: {
      viewId: "front",
      edges: [
        { id: "e1", sourceId: "s1", role: "visible", from: { x: 0, y: 0 }, to: { x: 1000, y: 0 } },
      ],
      annotations: [
        {
          id: "overall.width",
          kind: "dimension",
          valueMm: 1000,
          label: "Šířka",
          line: { from: { x: 0, y: -100 }, to: { x: 1000, y: -100 } },
          witness: [],
          textAt: { x: 500, y: -150 },
        },
      ],
      bbox: { min: { x: 0, y: 0 }, max: { x: 1000, y: 1500 } },
    },
  },
  specRows: {
    gate: [
      { key: "width", label: "Šířka průchodu", value: "1000 mm" },
      { key: "fill", label: "Výplň", value: "Svislá" },
    ],
  },
  dimensionRows: {
    gate: [{ id: "overall.width", label: "Šířka", valueMm: 1000 }],
  },
};

/** The N-1 payload: a quote issued before the frozen-drawing slice carries none
 *  of the three optional fields. */
const N1: QuoteProduction = {
  ...PRODUCTION,
  documentNumber: "2026/0001",
  technicalDrawings: undefined,
  specRows: undefined,
  dimensionRows: undefined,
};

function renderDoc(production: QuoteProduction) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <TravelerDocument production={production} backHref="/quotes/abc/production" />
    </I18nProvider>,
  );
}

describe("TravelerDocument — the shop-floor build sheet (ADR 0108)", () => {
  it("renders no price/cost/margin and no customer block", () => {
    const { container } = renderDoc(PRODUCTION);
    // The payload carries no money at all; the document must never surface one.
    // Read the sheet's own text — the inline print <style> legitimately holds the
    // CSS `margin` property, which is not a price.
    const sheet = container.querySelector("article");
    expect(screen.queryByText(/Kč/)).not.toBeInTheDocument();
    expect(sheet?.textContent).not.toMatch(/Kč|€|marže|náklad|margin|cost|price/i);
    // No customer/buyer identity is part of a production traveler.
    expect(screen.queryByText(/Odběratel/)).not.toBeInTheDocument();
  });

  it("groups the flat BOM by category", () => {
    renderDoc(PRODUCTION);
    // Both category headings render (Materiál / Příslušenství)...
    expect(screen.getByText("Materiál")).toBeInTheDocument();
    expect(screen.getByText("Příslušenství")).toBeInTheDocument();
    // ...and the two material lines + the one accessory line show as quantities.
    expect(screen.getByText("2 ks")).toBeInTheDocument();
    expect(screen.getByText("6 m")).toBeInTheDocument();
    expect(screen.getByText("4 ks")).toBeInTheDocument();
  });

  it("renders spec and dimension rows for the instance", () => {
    renderDoc(PRODUCTION);
    expect(screen.getByText("Šířka průchodu")).toBeInTheDocument();
    expect(screen.getByText("Svislá")).toBeInTheDocument();
    // The dimension row's label (exact) — distinct from the SVG's "Šířka 1000 mm".
    expect(screen.getByText("Šířka")).toBeInTheDocument();
  });

  it("renders an N-1 quote (no drawing/spec/dimension fields) without throwing", () => {
    expect(() => renderDoc(N1)).not.toThrow();
    // The document number rides the header and every instance block.
    expect(screen.getAllByText("2026/0001").length).toBeGreaterThan(0);
    // The site-level BOM/cut list still render for a pre-slice quote.
    expect(screen.getByText("Materiál")).toBeInTheDocument();
  });
});
