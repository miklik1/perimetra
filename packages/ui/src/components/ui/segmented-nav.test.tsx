import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedNav, SegmentedNavItem } from "./segmented-nav";

describe("SegmentedNav", () => {
  it("marks the active item pressed + the nav-active fill, others unpressed and muted", () => {
    render(
      <SegmentedNav value="plan" onValueChange={() => {}} aria-label="Zobrazení">
        <SegmentedNavItem value="plan" label="Půdorys" />
        <SegmentedNavItem value="model" label="3D model" />
      </SegmentedNav>,
    );
    const active = screen.getByRole("button", { name: "Půdorys" });
    const inactive = screen.getByRole("button", { name: "3D model" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(active).toHaveClass("bg-nav-active");
    // Emitted on BOTH segments: a toggle with a missing aria-pressed reads as a
    // plain button, so the unpressed state has to be stated, not left absent.
    expect(inactive).toHaveAttribute("aria-pressed", "false");
    expect(inactive).toHaveClass("text-muted-foreground");
  });

  it("is a named group, never a navigation landmark", () => {
    render(
      <SegmentedNav value="plan" onValueChange={() => {}} aria-label="Zobrazení">
        <SegmentedNavItem value="plan" label="Půdorys" />
      </SegmentedNav>,
    );
    expect(screen.getByRole("group", { name: "Zobrazení" })).toBeInTheDocument();
    // The landmark must not come back: this switches a view, not a page.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("button", { name: "Půdorys" })).not.toHaveAttribute("aria-current");
  });

  it("wraps the pills in the recessed chrome track by default and drops it when track=false", () => {
    const { rerender } = render(
      <SegmentedNav value="plan" onValueChange={() => {}} aria-label="Zobrazení">
        <SegmentedNavItem value="plan" label="Půdorys" />
      </SegmentedNav>,
    );
    expect(screen.getByRole("group")).toHaveClass("bg-chrome");
    rerender(
      <SegmentedNav value="plan" onValueChange={() => {}} track={false} aria-label="Zobrazení">
        <SegmentedNavItem value="plan" label="Půdorys" />
      </SegmentedNav>,
    );
    expect(screen.getByRole("group")).not.toHaveClass("bg-chrome");
  });

  it("calls onValueChange with the clicked item's value", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedNav value="plan" onValueChange={onValueChange} aria-label="Zobrazení">
        <SegmentedNavItem value="plan" label="Půdorys" />
        <SegmentedNavItem value="model" label="3D model" />
      </SegmentedNav>,
    );
    fireEvent.click(screen.getByRole("button", { name: "3D model" }));
    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("model");
  });

  it("composes a caller onClick with selection instead of clobbering it", () => {
    const onClick = vi.fn();
    const onValueChange = vi.fn();
    render(
      <SegmentedNav value="plan" onValueChange={onValueChange} aria-label="Zobrazení">
        <SegmentedNavItem value="model" label="3D model" onClick={onClick} />
      </SegmentedNav>,
    );
    fireEvent.click(screen.getByRole("button", { name: "3D model" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith("model");
  });

  it("throws when an Item is rendered outside its provider", () => {
    // React logs the render error to console.error; silence it for a clean run.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SegmentedNavItem value="x" label="X" />)).toThrow(
      /must be used within <SegmentedNav>/,
    );
    spy.mockRestore();
  });
});
