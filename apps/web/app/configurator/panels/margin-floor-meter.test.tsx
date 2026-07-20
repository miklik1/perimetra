import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { marginBreaches, MarginFloorMeter } from "./margin-floor-meter";

/**
 * The gauge owns two rules the surface cannot re-derive: ONE rounding shared by
 * the label and the breach test, and an axis that always contains both the
 * margin and the floor. Both are pinned here by behaviour (rendered text, ARIA
 * values, geometry), never by class names — a restyle must stay free.
 */

function renderMeter(marginPct: number, floorPct: number) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <MarginFloorMeter marginPct={marginPct} floorPct={floorPct} />
    </I18nProvider>,
  );
}

/** Testing-library normalizes whitespace before matching; do the same to reads. */
const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ");

const meter = () => screen.getByRole("meter");
const fill = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="margin-floor-fill"]')!;
const tick = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="margin-floor-tick"]')!;

describe("MarginFloorMeter — reading", () => {
  it("prints the rounded margin and the floor, and exposes both to assistive tech", () => {
    const { container } = renderMeter(33.99, 25);

    // The canvas's own numbers: 48 250 sell / 31 850 cost reads as 34 %.
    expect(screen.getByText("Marže 34 %")).toBeInTheDocument();
    expect(screen.getByText("limit 25 %")).toBeInTheDocument();

    // A real gauge, not a decorative div: named, ranged, with the true reading
    // in valuetext and the floor as its description.
    const gauge = meter();
    expect(gauge).toHaveAccessibleName("Marže");
    expect(gauge).toHaveAttribute("aria-valuetext", "Marže 34 %");
    expect(gauge).toHaveAttribute("aria-valuenow", "34");
    expect(gauge).toHaveAttribute("aria-valuemin", "0");
    expect(gauge).toHaveAccessibleDescription("limit 25 %");

    // Fill and tick sit on the SAME axis, so the bar visually crosses the tick
    // exactly when the number clears the floor.
    const max = Number(gauge.getAttribute("aria-valuemax"));
    expect(Number.parseFloat(fill(container).style.width)).toBeCloseTo((33.99 / max) * 100, 5);
    expect(Number.parseFloat(tick(container).style.left)).toBeCloseTo((25 / max) * 100, 5);
  });

  it("keeps the canvas 0-50 axis for ordinary margins", () => {
    renderMeter(34, 25);
    expect(meter()).toHaveAttribute("aria-valuemax", "50");
  });
});

describe("MarginFloorMeter — the rounding rule", () => {
  it("does NOT breach when the rounded margin displays as exactly the floor", () => {
    // 24.6 rounds UP to 25. Comparing the raw value against the floor would
    // paint a breach under a label reading "Marže 25 % · limit 25 %".
    const { container } = renderMeter(24.6, 25);

    expect(screen.getByText("Marže 25 %")).toBeInTheDocument();
    expect(marginBreaches(24.6, 25)).toBe(false);
    expect(meter()).not.toHaveAttribute("data-breach");
    expect(fill(container).className).toContain("bg-success");
  });

  it("breaches as soon as the rounded margin drops below the floor", () => {
    const { container } = renderMeter(24.4, 25);

    expect(screen.getByText("Marže 24 %")).toBeInTheDocument();
    expect(marginBreaches(24.4, 25)).toBe(true);
    expect(meter()).toHaveAttribute("data-breach", "true");
    expect(fill(container).className).toContain("bg-destructive");
  });

  it("rounds the floor with the same rule it rounds the margin", () => {
    // Both sides through Math.round: 17.4 vs a 17.4 floor is never a breach.
    expect(marginBreaches(17.4, 17.4)).toBe(false);
    renderMeter(17.4, 17.4);
    expect(screen.getByText("Marže 17 %")).toBeInTheDocument();
    expect(screen.getByText("limit 17 %")).toBeInTheDocument();
  });
});

describe("MarginFloorMeter — the axis rule", () => {
  it("grows the axis so a floor above the canvas's hardcoded 50 still fits", () => {
    // The canvas's fixed 0-50 axis would pin BOTH the fill and the tick to the
    // right edge here and the gauge would stop meaning anything.
    const { container } = renderMeter(70, 60);

    const max = Number(meter().getAttribute("aria-valuemax"));
    expect(max).toBeGreaterThan(70);
    expect(Number.parseFloat(tick(container).style.left)).toBeLessThan(100);
    expect(Number.parseFloat(fill(container).style.width)).toBeLessThan(100);
  });

  it("never exceeds a 100 % axis", () => {
    renderMeter(99, 95);
    expect(Number(meter().getAttribute("aria-valuemax"))).toBeLessThanOrEqual(100);
  });
});

describe("MarginFloorMeter — degenerate margins", () => {
  it("clamps a negative margin's geometry to zero while printing the true number", () => {
    // Cost above price is a real state; the bar bottoms out but the label must
    // not lie about it.
    const { container } = renderMeter(-20, 25);

    expect(screen.getByText("Marže -20 %")).toBeInTheDocument();
    expect(meter()).toHaveAttribute("data-breach", "true");
    expect(meter()).toHaveAttribute("aria-valuenow", "0");
    expect(fill(container).style.width).toBe("0%");
  });

  it("prints an inequality rather than '-Infinity' for a non-computable margin", () => {
    // `marginPct` returns -Infinity for a zero/negative price against a real
    // cost. It always breaches, and it must never render as a number.
    renderMeter(Number.NEGATIVE_INFINITY, 25);

    expect(norm(document.body.textContent)).toContain("Marže <0 %");
    expect(norm(document.body.textContent)).not.toContain("Infinity");
    expect(marginBreaches(Number.NEGATIVE_INFINITY, 25)).toBe(true);
    expect(meter()).toHaveAttribute("data-breach", "true");
  });
});
