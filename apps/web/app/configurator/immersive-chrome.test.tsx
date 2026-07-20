import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { deriveForUi } from "./derive";
import { goldenCatalogs, goldenPricing, goldenProducts } from "./golden-bundle";
import { ImmersiveChrome } from "./immersive-chrome";
import { useManipulation } from "./scene/manipulation";

/**
 * The immersive chrome (ADR 0116): the collapsed step trigger, the exit-to-form
 * trigger, and the minimal commercial chip. The chip is a money-bearing surface,
 * so it carries the §12.1 item 11 price-blind ABSENCE assertion; and, per
 * ADR 0116 §4, it carries no CTA.
 */
const gate = goldenProducts[0]!;
const result = deriveForUi(gate, gate.initialInput, goldenPricing, goldenCatalogs).result;

function renderChrome(over: Partial<React.ComponentProps<typeof ImmersiveChrome>> = {}) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ImmersiveChrome
        stepLabel="Výplň"
        current={2}
        total={6}
        onPrev={() => {}}
        onNext={() => {}}
        result={result}
        canSeeCost={false}
        priceBlind={false}
        {...over}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  useManipulation.setState({ immersive: true });
});

describe("ImmersiveChrome", () => {
  it("shows the step trigger and the exit-to-form control", () => {
    renderChrome();
    expect(screen.getByText("Výplň")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: cs.configurator.settings })).toBeInTheDocument();
  });

  it("shows the price for a sighted session", () => {
    renderChrome({ priceBlind: false });
    expect(screen.getByText(cs.configurator.priceExVat)).toBeInTheDocument();
    expect(screen.getByText(cs.configurator.configValidShort)).toBeInTheDocument();
  });

  it("omits the commercial chip entirely for a price-blind session (absence, not masking)", () => {
    renderChrome({ priceBlind: true });
    expect(screen.queryByText(cs.configurator.priceExVat)).toBeNull();
    expect(screen.queryByText(cs.configurator.configValidShort)).toBeNull();
    expect(screen.queryByText(/Kč/)).toBeNull();
    // The rest of the chrome still renders.
    expect(screen.getByRole("button", { name: cs.configurator.settings })).toBeInTheDocument();
  });

  it("carries no CTA (ADR 0116 §4)", () => {
    renderChrome();
    expect(screen.queryByText(cs.configurator.createQuote)).toBeNull();
  });

  it("marks prev aria-disabled (NOT native disabled) on the first step so focus is not lost", () => {
    renderChrome({ current: 1, total: 6 });
    const back = screen.getByRole("button", { name: cs.configurator.back });
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(back).not.toBeDisabled(); // native disabled would drop focus to <body> at the boundary
    expect(screen.getByRole("button", { name: cs.configurator.next })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("marks next aria-disabled on the last step", () => {
    renderChrome({ current: 6, total: 6 });
    const next = screen.getByRole("button", { name: cs.configurator.next });
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).not.toBeDisabled();
  });

  it("leaves immersive when the exit control is pressed", () => {
    renderChrome();
    fireEvent.click(screen.getByRole("button", { name: cs.configurator.settings }));
    expect(useManipulation.getState().immersive).toBe(false);
  });

  it("steps with the trigger's prev/next", () => {
    const onNext = vi.fn();
    renderChrome({ current: 2, total: 6, onNext });
    fireEvent.click(screen.getByRole("button", { name: cs.configurator.next }));
    expect(onNext).toHaveBeenCalled();
  });
});
