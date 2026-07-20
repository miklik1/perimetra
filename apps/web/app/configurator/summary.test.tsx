import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { resolveUi } from "@repo/model";

import { deriveForUi } from "./derive";
import { goldenCatalogs, goldenPricing, goldenProducts } from "./golden-bundle";
import { Summary } from "./summary";

/**
 * CAR-22: the Souhrn step's fake, client-state-only Poptávka lead form
 * (`setSubmitted(true)`, nothing persisted) is gone — the step's one primary
 * action is the real `SaveToProjectPanel` hand-off (CAR-13). This guards
 * against the fake form's copy/inputs ever creeping back in.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const gate = goldenProducts[0]!;

function renderSummary() {
  const derivation = deriveForUi(gate, gate.initialInput, goldenPricing, goldenCatalogs);
  const steps = resolveUi(gate.release, derivation.scope ?? gate.initialInput);
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <Summary
          steps={steps}
          scope={derivation.scope}
          input={gate.initialInput}
          result={derivation.result}
          optionSets={gate.release.optionSets ?? []}
          priceBlind={false}
          shareToken="test-token"
          drawing={derivation.drawing}
          releaseId={gate.release.id}
          productLabel={gate.release.modelId}
        />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("Summary (Souhrn step)", () => {
  it("ends in the save-to-project hand-off, not a lead form", () => {
    renderSummary();
    expect(screen.getByRole("heading", { name: "Uložit do projektu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uložit do projektu" })).toBeInTheDocument();
  });

  it("has no trace of the retired Poptávka lead form", () => {
    renderSummary();
    expect(screen.queryByText("Nezávazná poptávka")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Jméno")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("E-mail")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odeslat poptávku" })).not.toBeInTheDocument();
  });
});
