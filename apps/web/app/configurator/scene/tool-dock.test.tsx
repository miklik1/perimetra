import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { useExplode } from "./explode";
import { useManipulation } from "./manipulation";
import { useSection } from "./section";
import { ToolDock } from "./tool-dock";

/**
 * The immersive tool dock (ADR 0116): the six-tool set the canvas draws, with
 * Výběr/Kóty driving the manipulation store, Řez/Rozklad delegating to the
 * existing slices, and Měřit/Otočit deferred as disabled affordances.
 */
function renderDock(canExplode = true) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ToolDock canExplode={canExplode} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  useManipulation.setState({ tool: "select" });
  useSection.setState({ enabled: false });
  useExplode.setState({ target: 0, factor: 0 });
});

describe("ToolDock", () => {
  it("is a labelled toolbar carrying all six tools", () => {
    renderDock();
    const bar = screen.getByRole("toolbar", { name: cs.configurator.toolsLabel });
    for (const name of [
      cs.configurator.toolSelect,
      cs.configurator.toolDim,
      cs.configurator.section,
      cs.configurator.explode,
      cs.configurator.toolMeasure,
      cs.configurator.toolRotate,
    ]) {
      expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("defers Měřit and Otočit as disabled affordances", () => {
    renderDock();
    expect(screen.getByRole("button", { name: cs.configurator.toolMeasure })).toBeDisabled();
    expect(screen.getByRole("button", { name: cs.configurator.toolRotate })).toBeDisabled();
  });

  it("shows Výběr active by default and switches the tool to Kóty on click", () => {
    renderDock();
    expect(screen.getByRole("button", { name: cs.configurator.toolSelect })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: cs.configurator.toolDim }));
    expect(useManipulation.getState().tool).toBe("dim");
    expect(screen.getByRole("button", { name: cs.configurator.toolDim })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("delegates Řez to the section slice", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: cs.configurator.section }));
    expect(useSection.getState().enabled).toBe(true);
    expect(screen.getByRole("button", { name: cs.configurator.section })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("disables Rozklad when the release cannot explode", () => {
    renderDock(false);
    expect(screen.getByRole("button", { name: cs.configurator.explode })).toBeDisabled();
  });
});
