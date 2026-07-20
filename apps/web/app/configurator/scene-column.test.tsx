import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { deriveForUi, type UiDerivation } from "./derive";
import { goldenCatalogs, goldenPricing, goldenProducts } from "./golden-bundle";
import { SceneColumn, type SceneColumnProps } from "./scene-column";
import type { BrandStep } from "./wizard-flow";

/**
 * The scene column owns three things and this suite covers exactly those: the
 * view switch (state + a11y contract), the branch each (view, step) pair
 * resolves to, and the transitional/failure states that the old inline `Hero`
 * had no story for.
 *
 * WebGL: jsdom has none, and `SceneViewport` is a `ssr:false` dynamic import
 * that never resolves in a test, so the R3F tier is exercised through the
 * `webgl` prop (the same switch the app flips from `webglAvailable()`) and
 * asserted by its watermark rather than by its pixels. Geometry correctness is
 * proven elsewhere — this file is about which branch is chosen.
 *
 * Assertions are semantic (roles, names, text, absence) and carry no class-name
 * expectations.
 */

const gate = goldenProducts[0]!;

/** A real, engine-produced derivation — valid, so scene/drawing/plan all exist. */
function validDerivation(): UiDerivation {
  return deriveForUi(gate, gate.initialInput, goldenPricing, goldenCatalogs);
}

/** A real INVALID derivation (clear height below the minimum): no geometry (I5). */
function invalidDerivation(): UiDerivation {
  return deriveForUi(
    gate,
    { ...gate.initialInput, clear_height_mm: 100 },
    goldenPricing,
    goldenCatalogs,
  );
}

const sceneStep: BrandStep = {
  kind: "release",
  id: "konstrukce",
  view: "detail",
  plan: false,
  label: "Konstrukce",
  groups: [],
};

const planStep: BrandStep = { ...sceneStep, id: "rozmery", view: "hero", plan: true };

const BOM_SLOT = "bom-slot";

function renderColumn(overrides: Partial<SceneColumnProps> = {}) {
  const props: SceneColumnProps = {
    step: sceneStep,
    derivation: validDerivation(),
    computing: false,
    error: null,
    releaseId: gate.release.id,
    webgl: false,
    bom: <div data-testid={BOM_SLOT}>rozpad</div>,
    ...overrides,
  };
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <SceneColumn {...props} />
    </I18nProvider>,
  );
}

/** The switch's three segments, by their accessible name. */
function segment(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("SceneColumn — the view switch", () => {
  it("exposes a labelled group of pressable segments, not page navigation", () => {
    renderColumn();
    const group = screen.getByRole("group", { name: cs.configurator.viewSwitchLabel });
    expect(group).toBeInTheDocument();
    // A view switch is not navigation: no landmark, no "current page".
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    for (const el of [segment("3D"), segment("Výkres"), segment("Rozpad")]) {
      expect(group).toContainElement(el);
      expect(el).not.toHaveAttribute("aria-current");
      expect(el).toHaveAttribute("aria-pressed");
    }
  });

  it("starts on 3D and moves the pressed state as segments are activated", () => {
    renderColumn();
    expect(segment("3D")).toHaveAttribute("aria-pressed", "true");
    expect(segment("Výkres")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(segment("Výkres"));
    expect(segment("Výkres")).toHaveAttribute("aria-pressed", "true");
    expect(segment("3D")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(segment("Rozpad"));
    expect(segment("Rozpad")).toHaveAttribute("aria-pressed", "true");
    expect(segment("Výkres")).toHaveAttribute("aria-pressed", "false");
  });

  it("is absent while there is nothing derived to switch between", () => {
    renderColumn({ derivation: null });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();

    renderColumn({ derivation: null, error: "boom" });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});

describe("SceneColumn — the branches", () => {
  it("renders the live 3D branch when WebGL is up, watermarked as live", () => {
    renderColumn({ webgl: true });
    expect(screen.getByText(cs.configurator.watermarkLive)).toBeInTheDocument();
    expect(screen.queryByText(cs.configurator.watermarkDrawing)).not.toBeInTheDocument();
  });

  it("falls back to the SVG elevation when WebGL is unavailable", () => {
    renderColumn({ webgl: false });
    // Tier 2 of the chain: the drawing, honestly watermarked as the drawing.
    expect(screen.getByText(cs.configurator.watermarkDrawing)).toBeInTheDocument();
    expect(screen.queryByText(cs.configurator.watermarkLive)).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("shows the workshop drawing on the Výkres segment", () => {
    renderColumn({ webgl: true });
    fireEvent.click(segment("Výkres"));
    expect(screen.getByText(cs.configurator.watermarkDrawing)).toBeInTheDocument();
    expect(screen.queryByText(cs.configurator.watermarkLive)).not.toBeInTheDocument();
  });

  it("renders the injected BOM slot on Rozpad, with no watermark", () => {
    renderColumn({ webgl: true });
    fireEvent.click(segment("Rozpad"));
    expect(screen.getByTestId(BOM_SLOT)).toBeInTheDocument();
    expect(screen.queryByText(cs.configurator.watermarkLive)).not.toBeInTheDocument();
    expect(screen.queryByText(cs.configurator.watermarkDrawing)).not.toBeInTheDocument();
  });

  it("replaces the 3D position with the site plan on the step carrying `plan`", () => {
    renderColumn({ step: planStep, webgl: true });
    // The plan takes over the 3D position — so the live 3D watermark is absent…
    expect(screen.queryByText(cs.configurator.watermarkLive)).not.toBeInTheDocument();
    expect(screen.getByText(cs.configurator.watermarkDrawing)).toBeInTheDocument();
    // …and the switch still offers all three segments on that step.
    expect(segment("3D")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(segment("Rozpad"));
    expect(screen.getByTestId(BOM_SLOT)).toBeInTheDocument();
  });
});

describe("SceneColumn — failure and transitional states", () => {
  it("shows a polite scene-loading state instead of a blank box while computing", () => {
    renderColumn({ derivation: null, computing: true });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(cs.configurator.computing);
    expect(status).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the prior result on screen when a re-derive is in flight", () => {
    const { container } = renderColumn({ webgl: true, computing: true });
    // The scene stays: stale-while-revalidating, not a blank.
    expect(screen.getByText(cs.configurator.watermarkLive)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(cs.configurator.computing);
    expect(container.querySelector("[data-slot='scene-column']")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("announces a failed derive as an alert carrying the message", () => {
    renderColumn({ derivation: null, error: "Katalog není dostupný" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(cs.configurator.deriveFailed);
    expect(alert).toHaveTextContent("Katalog není dostupný");
  });

  it("outranks a stale result with the failure — the geometry no longer matches", () => {
    renderColumn({ webgl: true, error: "Katalog není dostupný" });
    expect(screen.getByRole("alert")).toHaveTextContent(cs.configurator.deriveFailed);
    expect(screen.queryByText(cs.configurator.watermarkLive)).not.toBeInTheDocument();
  });

  it("states the absence of geometric truth for an invalid configuration (I5)", () => {
    const derivation = invalidDerivation();
    expect(derivation.result.isValid).toBe(false);
    expect(derivation.scene).toBeUndefined();
    expect(derivation.drawing).toBeUndefined();

    renderColumn({ derivation, webgl: true });
    // Polite, not an alert: the issue list owns the errors themselves.
    expect(screen.getByRole("status")).toHaveTextContent(cs.configurator.sceneInvalid);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tints the stage on an invalid config without swallowing pointer events", () => {
    const { container } = renderColumn({ derivation: invalidDerivation(), webgl: true });
    const tint = container.querySelector(".pointer-events-none[aria-hidden='true']");
    expect(tint).not.toBeNull();
    expect(tint).toHaveClass("bg-destructive/5");
  });

  it("leaves the BOM untinted — a data table is not a scene", () => {
    const { container } = renderColumn({ derivation: invalidDerivation(), webgl: true });
    fireEvent.click(segment("Rozpad"));
    expect(screen.getByTestId(BOM_SLOT)).toBeInTheDocument();
    expect(container.querySelector(".bg-destructive\\/5")).toBeNull();
  });

  it("keeps every watermark out of the accessibility tree", () => {
    renderColumn({ webgl: true });
    const watermark = screen.getByText(cs.configurator.watermarkLive);
    expect(watermark).toHaveAttribute("aria-hidden", "true");
  });
});
