import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { resolveUi } from "@repo/model";

import { deriveForUi } from "./derive";
import { goldenCatalog, goldenPrices, goldenProducts } from "./golden-bundle";
import { Wizard } from "./wizard";

/**
 * The generated-surface proof: the wizard renders the sliding gate FROM ITS
 * RELEASE DATA (labels, steps, options — zero product knowledge in the app),
 * and the in-browser compute path reproduces the Excel-anchored golden total
 * (delta-0 reaching the UI layer). The 3D canvas itself stays untested here —
 * jsdom has no WebGL; frame/walker math is pure and lives outside it.
 */
const gate = goldenProducts[0]!;

function renderWizard(onValueChange = vi.fn(), stepIndex = 0) {
  const derivation = deriveForUi(gate, gate.initialInput, goldenPrices, goldenCatalog);
  const steps = resolveUi(gate.release, derivation.scope ?? gate.initialInput);
  render(
    <I18nProvider locale="cs" messages={cs}>
      <Wizard
        release={gate.release}
        steps={steps}
        stepIndex={stepIndex}
        input={gate.initialInput}
        scope={derivation.scope}
        onStepChange={vi.fn()}
        onValueChange={onValueChange}
      />
    </I18nProvider>,
  );
  return onValueChange;
}

describe("configurator (step 6 slice 1)", () => {
  it("derives the Excel-anchored golden total in the UI compute path", () => {
    const derivation = deriveForUi(gate, gate.initialInput, goldenPrices, goldenCatalog);
    expect(derivation.result.isValid).toBe(true);
    expect(derivation.result.money.total).toBe("81451.504");
    // The degenerate one-instance site renders: pieces present, none shared away.
    expect(derivation.scene?.instances).toHaveLength(1);
    expect(derivation.scene!.instances[0]!.pieces.length).toBeGreaterThan(10);
  });

  it("surfaces typed issues instead of partial output on invalid input (I5)", () => {
    const derivation = deriveForUi(
      gate,
      { ...gate.initialInput, clear_height_mm: 100 },
      goldenPrices,
      goldenCatalog,
    );
    expect(derivation.result.isValid).toBe(false);
    expect(derivation.scene).toBeUndefined();
    expect(derivation.result.issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("renders steps, groups, and field labels from the release data", () => {
    renderWizard();
    // Step tabs from UiSpec.
    expect(screen.getByRole("button", { name: "Rozměry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Konstrukce" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Výbava a práce" })).toBeInTheDocument();
    // Fields of the first step, labeled from ParameterDef.label.
    expect(screen.getByLabelText(/Šířka otvoru/)).toHaveValue(4000);
    expect(screen.getByLabelText(/Průjezdná výška/)).toHaveValue(1500);
  });

  it("renders option-set selects with vendor option labels", () => {
    renderWizard(vi.fn(), 1);
    const select = screen.getByLabelText("Typ výplně");
    expect(select).toHaveValue("planka_100_2d");
    expect(screen.getByRole("option", { name: "PLAŇKA 100 2D" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lamela 113 3D" })).toBeInTheDocument();
  });

  it("propagates edits as typed values and clears to default", () => {
    const onValueChange = renderWizard();
    fireEvent.change(screen.getByLabelText(/Šířka otvoru/), { target: { value: "4600" } });
    expect(onValueChange).toHaveBeenCalledWith("opening_width_mm", 4600);
    fireEvent.change(screen.getByLabelText(/Šířka otvoru/), { target: { value: "" } });
    expect(onValueChange).toHaveBeenCalledWith("opening_width_mm", undefined);
  });
});
