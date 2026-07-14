import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Checkbox, Switch } from "./switch";

describe("Switch", () => {
  it("toggles its checked state on click (uncontrolled) and carries the brand track token", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Zobrazit ceny" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole("switch");

    expect(sw).toHaveAttribute("data-slot", "switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw.className).toContain("bg-nav-active");

    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("Checkbox", () => {
  it("mounts the indicator check only in the checked state and carries the brand fill token", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Souhlasím s podmínkami" onCheckedChange={onCheckedChange} />);
    const cb = screen.getByRole("checkbox");

    expect(cb).toHaveAttribute("data-slot", "checkbox");
    expect(cb.className).toContain("bg-chrome-subtle");
    // Radix mounts the indicator (the check svg) only while checked.
    expect(cb.querySelector("[data-slot='checkbox-indicator']")).toBeNull();

    fireEvent.click(cb);
    expect(cb).toHaveAttribute("aria-checked", "true");
    expect(cb.querySelector("[data-slot='checkbox-indicator']")).not.toBeNull();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("renders the indeterminate (mixed) state, not a false check", () => {
    render(<Checkbox defaultChecked="indeterminate" aria-label="Částečně vybráno" />);
    const cb = screen.getByRole("checkbox");

    // Radix mounts the indicator for the mixed state and reports aria-checked="mixed".
    expect(cb).toHaveAttribute("aria-checked", "mixed");
    const indicator = cb.querySelector("[data-slot='checkbox-indicator']");
    expect(indicator).not.toBeNull();
    // The dash glyph is present so a mixed checkbox never reads as a full check.
    expect(indicator?.querySelector("path[d='M6 12h12']")).not.toBeNull();
  });
});
