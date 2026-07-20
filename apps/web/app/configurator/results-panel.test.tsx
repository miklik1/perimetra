import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DerivationResult, Part } from "@repo/engine";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { formatMoney } from "../../lib/format-money";
import { deriveForUi } from "./derive";
import { goldenCatalogs, goldenPrices, goldenProducts } from "./golden-bundle";
import { ResultsPanel } from "./results-panel";

/**
 * CHARACTERISATION suite — locks the CURRENT rendered behaviour of
 * `ResultsPanel` ahead of the ADR 0114 visual restyle. The panel is shared by
 * the configurator AND the release editor's Preview tab (out of scope for the
 * reskin), so a behavioural regression here would otherwise be silent.
 *
 * Assertions are deliberately semantic (roles, labels, text, absence) and
 * carry NO class-name expectations — a restyle must be free to change every
 * class and still pass.
 */

const gate = goldenProducts[0]!;

/** A real, engine-produced valid result (the delta-0 golden lineage). */
function goldenResult(): DerivationResult {
  return deriveForUi(gate, gate.initialInput, goldenPrices, goldenCatalogs).result;
}

/** A real, engine-produced INVALID result (clear height below the minimum). */
function invalidResult(): DerivationResult {
  return deriveForUi(
    gate,
    { ...gate.initialInput, clear_height_mm: 100 },
    goldenPrices,
    goldenCatalogs,
  ).result;
}

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

/** Hand-built result so a test can pin an exact issue sentence / part row. */
function makeResult(partial: Partial<DerivationResult> = {}): DerivationResult {
  return {
    isValid: false,
    derived: {},
    parts: [],
    totals: { ...emptyTotals },
    money: { ...emptyMoney },
    issues: [],
    stamps: { releaseId: "x@1", catalogVersion: 1, priceTableVersion: 1, overrideIds: [] },
    ...partial,
  };
}

function part(overrides: Partial<Part> = {}): Part {
  return {
    path: "frame",
    componentCode: "JEKL_60",
    name: "Jekl 60×40",
    unit: "meter",
    quantity: 12.5,
    category: "material",
    totalPrice: 1234.567,
    ...overrides,
  };
}

function renderPanel(result: DerivationResult, priceBlind = false) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ResultsPanel result={result} priceBlind={priceBlind} />
    </I18nProvider>,
  );
}

/** The formatter the panel actually uses, at the locale the panel renders at. */
const money = (decimal: string) => formatMoney(decimal, "cs");

/**
 * Testing-library normalizes the NBSP (U+00A0) that `Intl` currency output
 * carries into a plain space before matching, so expected strings have to be
 * normalized the same way. `money()` stays un-normalized for the tests that
 * pin the formatter's exact bytes.
 */
const norm = (text: string) => text.replace(/\s+/g, " ");
const moneyText = (decimal: string) => norm(money(decimal));

describe("ResultsPanel — category totals", () => {
  it("renders every category label with its money total, plus the grand total", () => {
    const result = goldenResult();
    expect(result.isValid).toBe(true);
    renderPanel(result);

    // Anchor on the description list itself, NOT on the heading's parentElement:
    // the restyle wraps the heading in `Panel.Header`, which would move the
    // totals out of that parent and break every assertion below for no
    // behavioural reason. The kit's `KeyValueList` still renders a real <dl>.
    const totals = screen.getByText("Celkem").closest("dl")!;
    for (const [label, value] of [
      ["Materiál", result.money.material],
      ["Příslušenství", result.money.accessory],
      ["Výroba", result.money.manufacturing],
      ["Montáž", result.money.installation],
      ["Celkem", result.money.total],
    ] as const) {
      expect(within(totals).getByText(label)).toBeInTheDocument();
      expect(within(totals).getByText(moneyText(value))).toBeInTheDocument();
    }
  });

  it("formats money as cs-CZ currency: grouped thousands, decimal comma, Kč suffix", () => {
    renderPanel(makeResult({ isValid: true, money: { ...emptyMoney, total: "81451.5" } }));

    // Pinned bytes: NBSP (U+00A0) group separator, comma decimal, min 2 /
    // max 3 fraction digits, NBSP + "Kč" suffix. Exactly what the panel must
    // keep producing after the restyle.
    expect(money("81451.5")).toBe(`81\u00a0451,50\u00a0Kč`);
    expect(money("1234.5678")).toBe(`1\u00a0234,568\u00a0Kč`);
    expect(money("0")).toBe(`0,00\u00a0Kč`);
    // ...and it is that string that reaches the DOM (NBSP-normalized by
    // testing-library before matching).
    expect(screen.getByText(moneyText("81451.5"))).toBeInTheDocument();
  });

  // This one asserts markup deliberately. <dl>/<dt>/<dd> is the ACCESSIBILITY
  // contract (a screen reader announces the term/definition pairing), not a
  // styling choice, and the kit's `KeyValueList` — the component the restyle
  // adopts — renders exactly that. Losing it would be a real regression.
  it("renders the totals as a description list (dt label / dd value pairing)", () => {
    renderPanel(makeResult({ isValid: true, money: { ...emptyMoney, total: "42" } }));

    const label = screen.getByText("Celkem");
    expect(label.tagName).toBe("DT");
    expect(screen.getByText(moneyText("42")).tagName).toBe("DD");
  });
});

describe("ResultsPanel — BOM table", () => {
  it("renders one row per derived part, with name, quantity+unit and price", () => {
    const result = goldenResult();
    renderPanel(result);

    const table = screen.getByRole("table");
    // header row + one row per part
    expect(within(table).getAllByRole("row")).toHaveLength(result.parts.length + 1);

    const first = result.parts[0]!;
    const cells = within(table).getAllByRole("row")[1]!;
    expect(within(cells).getByText(first.name)).toBeInTheDocument();
    expect(within(cells).getByText(`${first.quantity} ${first.unit}`)).toBeInTheDocument();
  });

  it("renders the Czech column headers", () => {
    renderPanel(goldenResult());
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Položka", "Množství", "Cena"]);
  });

  it("renders an em dash for a part with no resolved price", () => {
    renderPanel(
      makeResult({
        isValid: true,
        parts: [
          part({ path: "a", name: "S cenou" }),
          { ...part({ path: "b", name: "Bez ceny" }), totalPrice: undefined },
        ],
      }),
    );

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[1]!).getByText(moneyText("1234.567"))).toBeInTheDocument();
    expect(within(rows[2]!).getByText("—")).toBeInTheDocument();
  });
});

describe("ResultsPanel — issues (I5)", () => {
  it("renders engine issues as localized sentences, not raw keys", () => {
    const result = invalidResult();
    expect(result.isValid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    renderPanel(result);

    expect(screen.getByRole("heading", { name: "Problémy" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(result.issues.length);
    for (const item of items) {
      // A localized sentence — never a bare dotted key.
      expect(item.textContent).not.toMatch(/engine\.[a-z_.]+/);
    }
  });

  it("renders the severity badge and the interpolated message for a typed issue", () => {
    renderPanel(
      makeResult({
        issues: [
          {
            key: "engine.input.below_min",
            severity: "error",
            scope: "instance",
            params: { key: "clear_height_mm", value: 100, min: 800 },
          },
          {
            key: "engine.catalog.unresolved",
            severity: "warn",
            scope: "instance",
            params: { role: "frame_profile" },
          },
        ],
      }),
    );

    expect(screen.getByText("chyba")).toBeInTheDocument();
    expect(screen.getByText("varování")).toBeInTheDocument();
    expect(
      screen.getByText("Parametr „clear_height_mm“ (100) je pod minimem 800."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("V katalogu chybí komponenta pro roli „frame_profile“."),
    ).toBeInTheDocument();
  });

  it("does not render totals or the BOM while the result is invalid", () => {
    renderPanel(invalidResult());

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Souhrn" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kusovník" })).not.toBeInTheDocument();
  });

  it("renders no issues panel when there are no issues", () => {
    renderPanel(goldenResult());
    expect(screen.queryByRole("heading", { name: "Problémy" })).not.toBeInTheDocument();
  });
});

describe("ResultsPanel — empty state", () => {
  it("renders nothing at all for an invalid result with no issues", () => {
    const { container } = renderPanel(makeResult());
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders a valid result with zero parts as an empty BOM body, headers intact", () => {
    renderPanel(makeResult({ isValid: true }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(1); // header only
    expect(screen.getByRole("heading", { name: "Kusovník" })).toBeInTheDocument();
  });
});

describe("ResultsPanel — priceBlind (ADR 0056)", () => {
  /**
   * The load-bearing absence assertion. Price-blindness is proven GLOBALLY over
   * the rendered text — no currency token, no formatted-money shape, and none
   * of the concrete money strings this very result would have produced — rather
   * than by the absence of one element, so no future markup can reintroduce a
   * price anywhere in the subtree.
   */
  it("renders NO money anywhere in the container", () => {
    const result = goldenResult();
    const { container } = renderPanel(result, true);
    const text = container.textContent ?? "";

    // 1. No currency token in any form (NFC-normalized so a decomposed "c\u030c"
    //    cannot slip past).
    expect(text.normalize("NFC")).not.toMatch(/[Kk]\u010d|CZK|[\u20ac$\u00a3]/u);

    // 2. No formatted-money SHAPE anywhere: a decimal-comma amount ("234,50")
    //    or grouped thousands ("1 234" with NBSP / thin / plain space).
    //    Quantities render as raw JS numbers ("12.5 meter"), so neither shape
    //    can come from a quantity - only from a formatted price.
    expect(text).not.toMatch(/\d,\d/);
    expect(text).not.toMatch(/\d[\u00a0\u202f ]\d{3}/);

    // 3. Not one of the concrete money strings this very result WOULD have
    //    shown - formatted, and (in case a restyle drops the formatter) raw.
    //    Raw decimals are only asserted when they cannot be confused with a
    //    quantity already legitimately on screen.
    const wouldHaveShown = [
      ...Object.values(result.money),
      ...result.parts.flatMap((p) => (p.totalPrice === undefined ? [] : [String(p.totalPrice)])),
    ];
    expect(wouldHaveShown.length).toBeGreaterThan(4);
    const legitimate = new Set(result.parts.map((p) => String(p.quantity)));
    for (const decimal of wouldHaveShown) {
      expect(text).not.toContain(money(decimal));
      if (decimal.length >= 4 && !legitimate.has(decimal)) {
        expect(text).not.toContain(decimal);
      }
    }

    // 4. The money-bearing chrome is gone too: no totals panel, no price column.
    expect(screen.queryByRole("heading", { name: "Souhrn" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cena")).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Položka",
      "Množství",
    ]);
  });

  it("still renders the BOM items and quantities (blindness is money-only)", () => {
    const result = goldenResult();
    renderPanel(result, true);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(result.parts.length + 1);
    const first = result.parts[0]!;
    expect(within(table).getByText(first.name)).toBeInTheDocument();
    expect(
      within(table).getAllByText(`${first.quantity} ${first.unit}`).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("still renders issues when price-blind", () => {
    renderPanel(invalidResult(), true);
    expect(screen.getByRole("heading", { name: "Problémy" })).toBeInTheDocument();
  });
});
