import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { type QuoteProduction } from "@repo/validators";

import { ProductionView } from "./production-view";

/** A representative frozen production view — one instance, a nested cut, and
 *  an oversize piece, so every branch of the cut-list panel renders. */
const PRODUCTION: QuoteProduction = {
  id: "00000000-0000-7000-8000-000000000001",
  documentNumber: "2026/0001",
  status: "issued",
  createdAt: "2026-06-01T00:00:00.000Z",
  instances: [{ instanceId: "gate", releaseId: "sliding-gate@1" }],
  bom: [
    {
      componentCode: "POST",
      name: "Sloupek",
      unit: "piece",
      category: "material",
      quantity: 2,
      sources: [{ instanceId: "gate", path: "posts[0]" }],
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
        nesting: {
          stockLengthMm: 6000,
          kerfMm: 3,
          bars: [
            {
              index: 0,
              stockLengthMm: 6000,
              cuts: [{ lengthMm: 2100, source: "s1" }],
              usedMm: 2100,
              offcutMm: 3900,
            },
          ],
          oversize: [{ lengthMm: 6500, source: "s2" }],
        },
      },
    ],
  },
  cutOptions: { kerfMm: 3 },
  drawings: {
    site: { instances: [], connections: [], terrain: [] },
    instances: {
      gate: {
        quads: [
          {
            id: "post/p1",
            componentCode: "POST",
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 2100 },
              { x: 0, y: 2100 },
            ],
          },
        ],
        dims: [],
        flags: [],
        bbox: { min: { x: 0, y: 0 }, max: { x: 100, y: 2100 } },
      },
    },
  },
};

function renderView(production: QuoteProduction) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ProductionView production={production} travelerHref="/quotes/q1/production/traveler" />
    </I18nProvider>,
  );
}

describe("ProductionView — the workshop build sheet (CAR-24)", () => {
  it("renders the document header and status", () => {
    renderView(PRODUCTION);
    expect(screen.getByText("2026/0001")).toBeInTheDocument();
    expect(screen.getByText("Vydáno")).toBeInTheDocument();
  });

  it("renders BOM quantities, never a price column", () => {
    renderView(PRODUCTION);
    // "Sloupek" is both the BOM item name and the cut-list component heading —
    // both are legitimately present.
    expect(screen.getAllByText("Sloupek").length).toBe(2);
    expect(screen.getByText("2 piece")).toBeInTheDocument();
    expect(screen.queryByText(/Kč/)).not.toBeInTheDocument();
  });

  it("renders the cut list with lengths, nesting bars, and oversize pieces", () => {
    renderView(PRODUCTION);
    expect(screen.getByText("2100 mm")).toBeInTheDocument();
    expect(screen.getByText("2×")).toBeInTheDocument();
    expect(screen.getByText(/Tyč 1/)).toBeInTheDocument();
    expect(screen.getByText(/Přesahující díly/)).toBeInTheDocument();
    expect(screen.getByText(/6500/)).toBeInTheDocument();
  });

  it("labels the per-instance drawing by instance id and release", () => {
    renderView(PRODUCTION);
    const heading = screen.getByRole("heading", { name: /Sestava/ });
    expect(heading.textContent).toContain("gate");
    expect(heading.textContent).toContain("sliding-gate@1");
  });

  it("never renders a money value anywhere on the page", () => {
    const { container } = renderView(PRODUCTION);
    expect(container.textContent).not.toMatch(/\d[\s,.]?\d{3}\s*Kč/);
  });
});
