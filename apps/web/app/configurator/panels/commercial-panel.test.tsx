import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import type { DerivationResult, MoneyTotals } from "@repo/engine";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { DEFAULT_ROUNDING_POLICY } from "@repo/model";

import { formatMoney } from "../../../lib/format-money";
import { goldenPrices } from "../golden-bundle";
import type { ConfiguratorPricing } from "../products";
import { CommercialPanel } from "./commercial-panel";

/**
 * The panel's whole job is deciding WHO SEES WHICH MONEY, so the suite is built
 * around the three visibility rules (ADR 0056 price-blind, ADR 0116 admin-only
 * cost, and an absent cost layer) plus the states it owns: pending, blocked,
 * valid, and valid-but-below-floor.
 *
 * Absence is asserted against the whole document text, not against a query for a
 * hidden node: "the workshop viewer must not see the price" is only proven by the
 * digits being nowhere in the DOM.
 */

const CATALOG_VERSION = 3;

/** The canvas's own figures, so the rendered numbers match the design frame. */
const SELL = "48250";
const COST_HEALTHY = "31850"; // → 34 % margin, clears a 25 % floor
const COST_BREACH = "40100"; // → 17 % margin, breaches a 25 % floor

function money(total: string): MoneyTotals {
  return { material: total, accessory: "0", manufacturing: "0", installation: "0", total };
}

const emptyTotals = {
  material: 0,
  accessory: 0,
  manufacturing: 0,
  installation: 0,
  total: 0,
} as const;

function makeResult(partial: Partial<DerivationResult> = {}): DerivationResult {
  return {
    isValid: true,
    derived: {},
    parts: [],
    totals: { ...emptyTotals },
    money: money(SELL),
    issues: [],
    stamps: {
      releaseId: "sliding-gate@1",
      catalogVersion: 2,
      priceTableVersion: 1,
      overrideIds: [],
    },
    ...partial,
  };
}

function makePricing(marginFloorPct: number | null): ConfiguratorPricing {
  return {
    table: goldenPrices,
    cost: null,
    marginFloorPct,
    rounding: DEFAULT_ROUNDING_POLICY,
  };
}

function renderPanel(props: Partial<ComponentProps<typeof CommercialPanel>> = {}) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <CommercialPanel
        result={makeResult()}
        pricing={makePricing(25)}
        catalogVersion={CATALOG_VERSION}
        priceBlind={false}
        canSeeCost={true}
        {...props}
      />
    </I18nProvider>,
  );
}

/** Testing-library normalizes the NBSP in `Intl` currency output before matching. */
const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ");
const moneyText = (decimal: string) => norm(formatMoney(decimal, "cs"));
const bodyText = () => norm(document.body.textContent);

describe("CommercialPanel — rule 1: price-blind (ADR 0056)", () => {
  it("renders NOTHING for a price-blind viewer — absence, not a masked value", () => {
    const { container } = renderPanel({ priceBlind: true });

    expect(container).toBeEmptyDOMElement();

    // The proof that matters: no formatted price, and no raw digits either.
    expect(bodyText()).not.toContain(moneyText(SELL));
    expect(bodyText()).not.toContain("48");
    expect(screen.queryByText("Cena položky bez DPH")).not.toBeInTheDocument();
    expect(screen.queryByText("Nelze spočítat")).not.toBeInTheDocument();
  });

  it("stays absent in every other state — pending and blocked included", () => {
    for (const result of [null, makeResult({ isValid: false })]) {
      const { container, unmount } = renderPanel({ priceBlind: true, result });
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("price-blindness outranks cost visibility", () => {
    renderPanel({
      priceBlind: true,
      canSeeCost: true,
      result: makeResult({ costMoney: money(COST_HEALTHY) }),
    });

    expect(bodyText()).not.toContain(moneyText(COST_HEALTHY));
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });
});

describe("CommercialPanel — rule 2: cost is admin-only (ADR 0116)", () => {
  it("shows a sales viewer the sell price and NO cost, margin or floor gauge", () => {
    renderPanel({
      canSeeCost: false,
      result: makeResult({ costMoney: money(COST_HEALTHY) }),
    });

    // The sell price is theirs to see.
    expect(screen.getByText("Cena položky bez DPH")).toBeInTheDocument();
    expect(screen.getByText(moneyText(SELL))).toBeInTheDocument();

    // The cost layer is not — proven by absence of the figure itself, not by a
    // missing label.
    expect(bodyText()).not.toContain(moneyText(COST_HEALTHY));
    expect(bodyText()).not.toContain(moneyText("16400"));
    expect(screen.queryByText("Náklad (nákup)")).not.toBeInTheDocument();
    expect(screen.queryByText("Marže")).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(bodyText()).not.toContain("limit 25 %");
  });

  it("gives the sales viewer the SHORT validity line — it makes no margin claim", () => {
    renderPanel({ canSeeCost: false, result: makeResult({ costMoney: money(COST_HEALTHY) }) });

    expect(screen.getByText("Konfigurace platná")).toBeInTheDocument();
    expect(screen.queryByText(/marže nad limitem/)).not.toBeInTheDocument();
  });

  it("warns a margin-blind viewer about a breach WITHOUT disclosing the margin", () => {
    renderPanel({ canSeeCost: false, result: makeResult({ costMoney: money(COST_BREACH) }) });

    // The warning must reach this viewer: the floor is enforced server-side at
    // `issue`, so suppressing it entirely would let a sales rep build a
    // configuration and meet the breach only as a 422.
    expect(
      screen.getByText("Vydání této konfigurace bude vyžadovat schválení."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Konfigurace platná")).not.toBeInTheDocument();

    // …and it must leak nothing the ADR 0116 role split withholds: no margin
    // wording, no gauge, no cost figure, no derived margin figure.
    expect(screen.queryByText("Marže pod limitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText("Náklad (nákup)")).not.toBeInTheDocument();
    expect(bodyText()).not.toContain(moneyText(COST_BREACH));
    expect(bodyText()).not.toMatch(/\d+\s*%/);
  });
});

describe("CommercialPanel — rule 3: the price table may carry no cost layer", () => {
  it("shows price and the short validity line, never a 0 % margin, when costMoney is absent", () => {
    renderPanel({ canSeeCost: true, result: makeResult() });

    expect(screen.getByText(moneyText(SELL))).toBeInTheDocument();
    expect(screen.queryByText("Náklad (nákup)")).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(bodyText()).not.toContain("Marže 0 %");
    expect(screen.getByText("Konfigurace platná")).toBeInTheDocument();
  });
});

describe("CommercialPanel — the admin view", () => {
  it("renders the price card, the cost and margin rows, the gauge and the validity line", () => {
    renderPanel({
      pricing: makePricing(25),
      result: makeResult({ costMoney: money(COST_HEALTHY) }),
    });

    expect(screen.getByText("Cena položky bez DPH")).toBeInTheDocument();
    expect(screen.getByText(moneyText(SELL))).toBeInTheDocument();
    expect(screen.getByText("katalog 3")).toBeInTheDocument();

    expect(screen.getByText("Náklad (nákup)")).toBeInTheDocument();
    expect(screen.getByText(moneyText(COST_HEALTHY))).toBeInTheDocument();

    // Margin as money: 48 250 − 31 850, derived for display only.
    expect(screen.getByText("Marže")).toBeInTheDocument();
    expect(screen.getByText(moneyText("16400"))).toBeInTheDocument();

    // …and as the gauge's percent, against the org floor.
    const gauge = screen.getByRole("meter");
    expect(gauge).toHaveAttribute("aria-valuetext", "Marže 34 %");
    expect(gauge).not.toHaveAttribute("data-breach");

    expect(screen.getByText("Konfigurace platná · marže nad limitem")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("drops the gauge and downgrades the validity line when the org sets no floor", () => {
    renderPanel({
      pricing: makePricing(null),
      result: makeResult({ costMoney: money(COST_HEALTHY) }),
    });

    // Cost and margin still show — there is simply nothing to measure against.
    expect(screen.getByText(moneyText(COST_HEALTHY))).toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByText("Konfigurace platná")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CommercialPanel — the margin floor breach", () => {
  it("announces the breach in a live region and states the consequence", () => {
    renderPanel({
      pricing: makePricing(25),
      result: makeResult({ costMoney: money(COST_BREACH) }),
    });

    // `Alert tone="warning"` derives role="alert", so the breach interrupts
    // rather than waiting to be discovered.
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Marže pod limitem");
    expect(banner).toHaveTextContent("Vydání nabídky bude vyžadovat schválení odchylky.");

    expect(screen.getByRole("meter")).toHaveAttribute("data-breach", "true");
    expect(screen.queryByText("Konfigurace platná · marže nad limitem")).not.toBeInTheDocument();
  });

  it("ships no deviation-approval control and no CTAs — the panel is information only", () => {
    renderPanel({
      pricing: makePricing(25),
      result: makeResult({ costMoney: money(COST_BREACH) }),
    });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(bodyText()).not.toContain("Povolit odchylku");
    expect(bodyText()).not.toContain("Vytvořit nabídku");
  });
});

describe("CommercialPanel — non-derivable and pending states", () => {
  it("shows the blocked placeholder with no money at all when the config is invalid", () => {
    renderPanel({ result: makeResult({ isValid: false, costMoney: money(COST_HEALTHY) }) });

    const blocked = screen.getByRole("status");
    expect(blocked).toHaveTextContent("Nelze spočítat");
    expect(blocked).toHaveTextContent("Konfigurace obsahuje chybu.");

    expect(bodyText()).not.toContain(moneyText(SELL));
    expect(bodyText()).not.toContain(moneyText(COST_HEALTHY));
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("shows a busy skeleton, not an empty box, while the first derive runs", () => {
    const { container } = renderPanel({ result: null });

    expect(container).not.toBeEmptyDOMElement();
    expect(container.querySelector('[data-slot="skeleton-text"]')).toBeInTheDocument();
    expect(container.querySelector("[aria-busy='true']")).toBeInTheDocument();
    // Deliberately NO status region here: the context bar announces
    // "recalculating" for the surface, and this panel's pending state mounts at
    // exactly the same moments — a second region made one event announce twice
    // with identical text.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(bodyText()).not.toContain(moneyText(SELL));
  });
});
