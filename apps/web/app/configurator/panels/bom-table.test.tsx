import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DerivationResult, Part } from "@repo/engine";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { DEFAULT_ROUNDING_POLICY } from "@repo/model";

import { formatMoney } from "../../../lib/format-money";
import { BomTable } from "./bom-table";

/**
 * The rozpad view owns three things nothing else in the app owns: the grouping
 * (four fixed buckets, empty ones omitted), the column set, and the ADR 0056
 * price-blind variant. The suite is deliberately semantic — roles, accessible
 * names, `scope` attributes, text presence and ABSENCE — so a restyle can
 * change every class and still pass.
 */

const emptyMoney = {
  material: "0",
  accessory: "0",
  manufacturing: "0",
  installation: "0",
  total: "0",
} as const;

const emptyTotals = {
  material: 0,
  accessory: 0,
  manufacturing: 0,
  installation: 0,
  total: 0,
} as const;

function part(overrides: Partial<Part> = {}): Part {
  return {
    path: "frame",
    componentCode: "JEKL_60",
    name: "Jekl 60×40",
    unit: "meter",
    quantity: 12.5,
    category: "material",
    lengthMm: 2500,
    pricePerUnit: 98.76,
    totalPrice: 1234.567,
    ...overrides,
  };
}

function makeResult(partial: Partial<DerivationResult> = {}): DerivationResult {
  return {
    isValid: true,
    derived: {},
    parts: [],
    totals: { ...emptyTotals },
    money: { ...emptyMoney },
    issues: [],
    stamps: { releaseId: "gate@1", catalogVersion: 1, priceTableVersion: 1, overrideIds: [] },
    ...partial,
  };
}

/** One part in each of the four buckets, deliberately supplied OUT of render order. */
function fourBucketResult(): DerivationResult {
  return makeResult({
    parts: [
      part({ path: "labour", name: "Svařování", category: "manufacturing", unit: "hour" }),
      part({ path: "frame", name: "Jekl 60×40", category: "material" }),
      part({ path: "mount", name: "Montáž na místě", category: "installation", unit: "set" }),
      part({ path: "lock", name: "Zámek", category: "accessory", unit: "piece" }),
    ],
    money: {
      material: "5000.5",
      accessory: "800.25",
      manufacturing: "2000",
      installation: "4544.999",
      total: "12345.749",
    },
  });
}

const money = (decimal: string) => formatMoney(decimal, "cs");

/** Testing-library collapses the NBSP that `Intl` currency output carries. */
const moneyText = (decimal: string) => money(decimal).replace(/\s+/g, " ");

function renderPriced(result: DerivationResult) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <BomTable result={result} rounding={DEFAULT_ROUNDING_POLICY} />
    </I18nProvider>,
  );
}

function renderPriceBlind(result: DerivationResult) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <BomTable.PriceBlind result={result} rounding={DEFAULT_ROUNDING_POLICY} />
    </I18nProvider>,
  );
}

const table = () => screen.getByRole("table", { name: "Rozpad" });

describe("BomTable — grouping", () => {
  it("renders the four category groups in the fixed totals order, not input order", () => {
    renderPriced(fourBucketResult());

    const headings = Array.from(table().querySelectorAll('th[scope="rowgroup"]')).map(
      (th) => th.textContent,
    );
    expect(headings).toEqual(["Materiál", "Příslušenství", "Výroba", "Montáž"]);
  });

  it("omits a category that has no parts entirely — no empty heading", () => {
    renderPriced(
      makeResult({
        parts: [part({ category: "material" }), part({ path: "lock", category: "accessory" })],
      }),
    );

    const headings = Array.from(table().querySelectorAll('th[scope="rowgroup"]')).map(
      (th) => th.textContent,
    );
    expect(headings).toEqual(["Materiál", "Příslušenství"]);
    expect(within(table()).queryByText("Výroba")).toBeNull();
    expect(within(table()).queryByText("Montáž")).toBeNull();
  });

  it("puts each part in its own group's row body", () => {
    renderPriced(fourBucketResult());

    const bodies = table().querySelectorAll("tbody");
    expect(bodies).toHaveLength(4);
    expect(within(bodies[0] as HTMLElement).getByText("Jekl 60×40")).toBeInTheDocument();
    expect(within(bodies[3] as HTMLElement).getByText("Montáž na místě")).toBeInTheDocument();
  });

  it("renders the empty state, and no table at all, when there are no parts", () => {
    renderPriced(makeResult({ parts: [] }));

    expect(screen.getByText("Konfigurace zatím neobsahuje žádné položky.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("BomTable — columns", () => {
  it("renders all five column headers", () => {
    renderPriced(fourBucketResult());

    const headers = Array.from(table().querySelectorAll('th[scope="col"]')).map(
      (th) => th.textContent,
    );
    expect(headers).toEqual(["Položka", "Množství", "Rozměr", "Cena/ks", "Celkem"]);
  });

  it("renders quantity with its unit and dimension in millimetres, locale-formatted", () => {
    renderPriced(makeResult({ parts: [part({ quantity: 12.5, lengthMm: 2500 })] }));

    expect(within(table()).getByText("12,5 m")).toBeInTheDocument();
    // `Intl` groups thousands with an NBSP in cs; testing-library normalizes it
    // to a plain space before matching, so the expectation is normalized too.
    const grouped = new Intl.NumberFormat("cs", { maximumFractionDigits: 3 })
      .format(2500)
      .replace(/\s/g, " ");
    expect(within(table()).getByText(`${grouped} mm`)).toBeInTheDocument();
  });

  it("shows an em-dash for a part with no length (a BOM-only labour line)", () => {
    renderPriced(
      makeResult({
        parts: [part({ name: "Svařování", category: "manufacturing", lengthMm: undefined })],
      }),
    );

    const row = within(table()).getByText("Svařování").closest("tr")!;
    expect(within(row).getAllByText("—")).toHaveLength(1);
  });

  it("rounds line money to the org's policy, so lines add up to their subtotal", () => {
    renderPriced(makeResult({ parts: [part()] }));

    const row = within(table()).getByText("Jekl 60×40").closest("tr")!;
    expect(within(row).getByText(moneyText("98.76"))).toBeInTheDocument();
    // `1234.567` is a raw derivation float. Rendered straight it printed
    // 1 234,567 Kč — a sub-haléř amount that is not payable in CZK, and one
    // that cannot add up to the policy-rounded subtotal on the same row. It
    // must go through the SAME rounding the engine applied to `result.money`.
    expect(within(row).getByText(moneyText("1234.57"))).toBeInTheDocument();
    expect(within(row).queryByText(moneyText("1234.567"))).not.toBeInTheDocument();
  });
});

describe("BomTable — totals", () => {
  it("takes each group subtotal from the matching result.money bucket", () => {
    renderPriced(fourBucketResult());

    for (const [label, decimal] of [
      ["Materiál", "5000.5"],
      ["Příslušenství", "800.25"],
      ["Výroba", "2000"],
      ["Montáž", "4544.999"],
    ] as const) {
      const row = within(table()).getByText(label).closest("tr")!;
      expect(within(row).getByText(moneyText(decimal))).toBeInTheDocument();
    }
  });

  it("renders the grand total from result.money.total in the table footer", () => {
    renderPriced(fourBucketResult());

    const foot = table().querySelector("tfoot")!;
    expect(within(foot).getByText("Celkem")).toBeInTheDocument();
    expect(within(foot).getByText(moneyText("12345.749"))).toBeInTheDocument();
  });
});

describe("BomTable.PriceBlind — ADR 0056 absence, not masking", () => {
  it("omits both money column headers", () => {
    renderPriceBlind(fourBucketResult());

    const headers = Array.from(table().querySelectorAll('th[scope="col"]')).map(
      (th) => th.textContent,
    );
    expect(headers).toEqual(["Položka", "Množství", "Rozměr"]);
    expect(screen.queryByText("Cena/ks")).toBeNull();
    // `bomLineTotal` and `totalTotal` are both "Celkem", so its total absence
    // proves the money column AND the grand-total row are gone.
    expect(screen.queryByText("Celkem")).toBeNull();
  });

  it("renders no money value anywhere — not blanked, not masked, absent", () => {
    renderPriceBlind(fourBucketResult());

    for (const decimal of ["98.76", "1234.567", "5000.5", "12345.749"]) {
      expect(screen.queryByText(moneyText(decimal))).toBeNull();
    }
    // No stray currency symbol survived on any other code path either.
    expect(screen.queryByText(/Kč/)).toBeNull();
  });

  it("emits no tfoot at all, so there is no empty total row", () => {
    renderPriceBlind(fourBucketResult());
    expect(table().querySelector("tfoot")).toBeNull();
  });

  it("keeps every non-money cell: items, quantities and dimensions", () => {
    renderPriceBlind(fourBucketResult());

    expect(within(table()).getByText("Jekl 60×40")).toBeInTheDocument();
    expect(within(table()).getByText("12,5 m")).toBeInTheDocument();
    expect(within(table()).getAllByRole("row").length).toBeGreaterThan(4);
  });
});

describe("BomTable — accessibility", () => {
  it("names the table from the visible panel title", () => {
    renderPriced(fourBucketResult());
    expect(screen.getByRole("table", { name: "Rozpad" })).toBeInTheDocument();
  });

  it("scopes column headers to their column and part names to their row", () => {
    renderPriced(makeResult({ parts: [part()] }));

    expect(table().querySelectorAll('thead th[scope="col"]')).toHaveLength(5);
    const rowHeader = within(table()).getByText("Jekl 60×40");
    expect(rowHeader.tagName).toBe("TH");
    expect(rowHeader.getAttribute("scope")).toBe("row");
  });

  it("associates a group heading with its row group", () => {
    renderPriced(fourBucketResult());

    const heading = within(table()).getByText("Materiál");
    expect(heading.tagName).toBe("TH");
    expect(heading.getAttribute("scope")).toBe("rowgroup");
    expect(heading.closest("tbody")).toContainElement(within(table()).getByText("Jekl 60×40"));
  });

  it("exposes the scroll container as a keyboard-reachable named region", () => {
    renderPriced(fourBucketResult());

    const region = screen.getByRole("region", { name: "Rozpad" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(table());
  });
});
