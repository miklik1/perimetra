import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedNav, SegmentedNavItem } from "./segmented-nav";

describe("SegmentedNav", () => {
  it("marks the active item with aria-current + the nav-active fill, others muted", () => {
    render(
      <SegmentedNav value="plan" onValueChange={() => {}} aria-label="Zobrazení">
        <SegmentedNavItem value="plan" label="Půdorys" />
        <SegmentedNavItem value="model" label="3D model" />
      </SegmentedNav>,
    );
    const active = screen.getByRole("button", { name: "Půdorys" });
    const inactive = screen.getByRole("button", { name: "3D model" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("bg-nav-active");
    expect(inactive).not.toHaveAttribute("aria-current");
    expect(inactive).toHaveClass("text-muted-foreground");
  });

  it("wraps the pills in the recessed chrome track by default and drops it when track=false", () => {
    const { rerender } = render(
      <SegmentedNav value="plan" onValueChange={() => {}} aria-label="Zobrazení">
        <SegmentedNavItem value="plan" label="Půdorys" />
      </SegmentedNav>,
    );
    expect(screen.getByRole("navigation")).toHaveClass("bg-chrome");
    rerender(
      <SegmentedNav value="plan" onValueChange={() => {}} track={false} aria-label="Zobrazení">
        <SegmentedNavItem value="plan" label="Půdorys" />
      </SegmentedNav>,
    );
    expect(screen.getByRole("navigation")).not.toHaveClass("bg-chrome");
  });

  it("calls onValueChange with the clicked item's value", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedNav value="plan" onValueChange={onValueChange}>
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
      <SegmentedNav value="plan" onValueChange={onValueChange}>
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
