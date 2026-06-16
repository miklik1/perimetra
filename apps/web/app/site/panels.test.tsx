import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { goldenCtx, goldenProducts } from "../configurator/golden-bundle";
import { deriveSiteForUi } from "./derive";
import { demoInstances, demoSite } from "./initial";
import { Palette } from "./palette";
import { PlanCanvas } from "./plan-canvas";
import { SiteResultsPanel } from "./site-results-panel";

/**
 * Render-layer proof for the site canvas's presentational components (the shell
 * itself carries AuthGuard + router, so — like the configurator test — the parts
 * are exercised in isolation): the aggregate total reaches the panel, the plan
 * exposes draggable/connectable ports off engine anchors, and the connect/remove
 * intents fire. Numeric delta-0 locks live in derive.test.ts.
 */
const seeded = () => deriveSiteForUi(goldenCtx, demoSite(), demoInstances(goldenProducts));

function ui(node: ReactNode) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      {node}
    </I18nProvider>,
  );
}

describe("site results panel", () => {
  it("renders the golden aggregate total and BOM rows", () => {
    const d = seeded();
    ui(<SiteResultsPanel result={d.result} />);
    const expected = new Intl.NumberFormat("cs", {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 3,
    })
      .format(Number("129891.504"))
      // Match Testing Library's default whitespace normalisation (it collapses
      // the formatter's narrow-no-break spaces to ordinary spaces).
      .replace(/\s+/g, " ");
    expect(screen.getByText(expected)).toBeInTheDocument();
    // The aggregate BOM has rows (one <tr> per line plus the header row).
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });
});

describe("palette", () => {
  it("lists placed instances and fires add/select/remove", () => {
    const d = seeded();
    const onAdd = vi.fn();
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    ui(
      <Palette
        products={goldenProducts}
        instances={d.instances}
        onAdd={onAdd}
        onSelect={onSelect}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ sliding-gate" }));
    expect(onAdd).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByText("sliding-gate · gate"));
    expect(onSelect).toHaveBeenCalledWith("gate");

    fireEvent.click(screen.getByRole("button", { name: "Odebrat fenceA" }));
    expect(onRemove).toHaveBeenCalledWith("fenceA");
  });
});

describe("plan canvas", () => {
  it("renders port handles and fires connect/remove intents", () => {
    const d = seeded();
    const onPortClick = vi.fn();
    const onRemoveConnection = vi.fn();
    ui(
      <PlanCanvas
        instances={d.instances}
        connections={d.connections}
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onPortClick={onPortClick}
        onRemoveConnection={onRemoveConnection}
      />,
    );
    // A FREE port handle off the engine-derived anchor (gate.left is unused in
    // the seed; gate.right is already joined to fenceA and therefore inert).
    fireEvent.pointerDown(screen.getByRole("button", { name: "Port left prvku gate" }));
    expect(onPortClick).toHaveBeenCalledWith("gate", "left");

    // Two seeded connections → two remove affordances.
    const removers = screen.getAllByRole("button", { name: "Odebrat spojení" });
    expect(removers).toHaveLength(2);
    fireEvent.pointerDown(removers[0]!);
    expect(onRemoveConnection).toHaveBeenCalledWith(0);
  });

  it("still outlines instances when the site is invalid (editing survives I5)", () => {
    const site = demoSite();
    const tooSteep = {
      ...site,
      terrain: site.terrain.map((s) => (s.id === "s2" ? { ...s, elevation_mm: 400 } : s)),
    };
    const d = deriveSiteForUi(goldenCtx, tooSteep, demoInstances(goldenProducts));
    expect(d.result.isValid).toBe(false);
    ui(
      <PlanCanvas
        instances={d.instances}
        connections={d.connections}
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onPortClick={vi.fn()}
        onRemoveConnection={vi.fn()}
      />,
    );
    // The plan still shows every instance label even with the site invalid.
    expect(screen.getByText("sliding-gate · gate")).toBeInTheDocument();
    expect(screen.getByText("fence-run · fenceB")).toBeInTheDocument();
  });
});
