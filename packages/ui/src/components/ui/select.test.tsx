import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

describe("Select", () => {
  it("renders a closed, input-styled combobox showing the placeholder", () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Vyberte profil" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="al-40">AL-PRF-40</SelectItem>
          <SelectItem value="al-60">AL-PRF-60</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveAttribute("data-slot", "select-trigger");
    // Closed by default (Radix behavior preserved); the listbox is not mounted.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Vyberte profil")).toBeInTheDocument();
    // Recessed-chrome brand token — the trigger reads as an input well.
    expect(trigger.className).toContain("bg-chrome-subtle");
  });

  it("throws a branded error when a styled part is used outside <Select>", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SelectItem value="x">X</SelectItem>)).toThrow(/within <Select>/);
    expect(() => render(<SelectContent>X</SelectContent>)).toThrow(/within <Select>/);
    spy.mockRestore();
  });
});
