import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StepNav, StepProgress } from "./step-nav";

function Rail({
  value = "rozmery",
  onValueChange = () => {},
}: {
  value?: string;
  onValueChange?: (v: string) => void;
}) {
  return (
    <StepNav value={value} onValueChange={onValueChange} aria-label="Konfigurace">
      <StepNav.Heading>Konfigurace</StepNav.Heading>
      <StepNav.Item value="produkt" state="done">
        <StepNav.Label>Produkt</StepNav.Label>
        <StepNav.Sub>Brána posuvná</StepNav.Sub>
      </StepNav.Item>
      <StepNav.Item value="rozmery">
        <StepNav.Label>Rozměry</StepNav.Label>
        <StepNav.Sub>4 000 × 1 800</StepNav.Sub>
      </StepNav.Item>
      <StepNav.Item value="motorizace" state="locked">
        <StepNav.Label>Motorizace</StepNav.Label>
      </StepNav.Item>
    </StepNav>
  );
}

describe("StepNav", () => {
  it("marks the step matching the root's value as current — active is derived, never passed", () => {
    render(<Rail value="rozmery" />);

    expect(screen.getByRole("button", { name: /Rozměry/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /Produkt/ })).not.toHaveAttribute("aria-current");
  });

  it("selects a step on click and reports its value", () => {
    const onValueChange = vi.fn();
    render(<Rail onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Produkt/ }));
    expect(onValueChange).toHaveBeenCalledWith("produkt");
  });

  it("numbers the dots from real sibling order, so a conditional step cannot desync them", () => {
    render(<Rail />);
    const dots = document.querySelectorAll('[data-slot="step-nav-dot"]');

    // Step 1 is done and step 3 is locked, so only step 2 shows an ordinal —
    // and it must be 2, its true position, not a caller-supplied index.
    expect(dots).toHaveLength(3);
    expect(dots[1]?.textContent).toBe("2");
  });

  it("derives the dot's glyph from state — a locked step can never show a checkmark", () => {
    render(<Rail />);
    const dots = document.querySelectorAll('[data-slot="step-nav-dot"]');

    expect(dots[0]?.querySelector("[data-icon]")).toHaveAttribute("data-icon", "check");
    expect(dots[2]?.querySelector("[data-icon]")).toHaveAttribute("data-icon", "lock");
    expect(dots[1]?.querySelector("[data-icon]")).toBeNull();
  });

  it("keeps a locked step discoverable but unselectable", () => {
    const onValueChange = vi.fn();
    render(<Rail onValueChange={onValueChange} />);
    const locked = screen.getByRole("button", { name: /Motorizace/ });

    expect(locked).toHaveAttribute("aria-disabled", "true");
    // Not natively disabled: the user must be able to read that it is coming.
    expect(locked).not.toBeDisabled();

    fireEvent.click(locked);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("keeps every step's accessible name when the rail collapses to dots", () => {
    // The collapsed rail in the export labels its dots with `title`, which
    // design/README.md §12.2 bans. Here the label is a slot that goes sr-only,
    // so the name survives at every width and no `title` is ever emitted.
    render(<Rail />);

    for (const item of screen.getAllByRole("button")) {
      expect(item).not.toHaveAttribute("title");
    }
    expect(screen.getByRole("button", { name: /Produkt/ })).toBeInTheDocument();
  });

  it("has no compact/collapsed prop — density is the container's business", () => {
    // Pinning the API shape itself: nine screens that each compute their own
    // density boolean eventually disagree (design/README.md §9.3).
    render(<Rail />);
    const nav = screen.getByRole("navigation", { name: "Konfigurace" });
    expect(nav.className).toMatch(/@container\/step-nav/);
  });

  it("throws when an item escapes its rail", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<StepNav.Item value="x">x</StepNav.Item>)).toThrow(
      /<StepNav.Item> must be rendered inside <StepNav>/,
    );
    spy.mockRestore();
  });

  it("throws when a label escapes its item", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<StepNav.Label>x</StepNav.Label>)).toThrow(
      /<StepNav.Label> must be rendered inside <StepNav.Item>/,
    );
    spy.mockRestore();
  });
});

describe("StepProgress", () => {
  it("reports progress semantically rather than as decorative bars", () => {
    render(<StepProgress total={6} current={3} />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemin", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "6");
    expect(bar).toHaveTextContent("3/6");
  });

  it("widens the current bar and marks every reached one", () => {
    render(<StepProgress total={6} current={3} />);
    const bars = document.querySelectorAll('[data-slot="step-progress-bar"]');

    expect(bars).toHaveLength(6);
    expect(bars[2]).toHaveAttribute("data-reached");
    expect(bars[3]).not.toHaveAttribute("data-reached");
  });

  it("renders no interactive target — it reports progress, it does not navigate", () => {
    render(<StepProgress total={6} current={3} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
