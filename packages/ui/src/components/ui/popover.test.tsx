import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./popover";

// jsdom ships no ResizeObserver; radix's Popper observes the anchor on open.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("Popover", () => {
  it("stays closed until the trigger is clicked, then reveals the content", () => {
    render(
      <Popover>
        <PopoverTrigger>Detaily</PopoverTrigger>
        <PopoverContent>Rozměr 3 600 × 1 800 mm</PopoverContent>
      </Popover>,
    );

    expect(screen.queryByText("Rozměr 3 600 × 1 800 mm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Detaily" }));

    expect(screen.getByText("Rozměr 3 600 × 1 800 mm")).toBeInTheDocument();
  });

  it("marks its parts with data-slot and skins the panel with the brand chrome tokens", () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Detaily</PopoverTrigger>
        <PopoverContent>Obsah</PopoverContent>
      </Popover>,
    );

    expect(screen.getByRole("button", { name: "Detaily" })).toHaveAttribute(
      "data-slot",
      "popover-trigger",
    );

    const content = screen.getByText("Obsah");
    expect(content).toHaveAttribute("data-slot", "popover-content");
    // Flat-matte chrome floated by a shadow, not glass (the brand depth model).
    expect(content).toHaveClass("bg-chrome");
    expect(content).toHaveClass("rounded-card");
    expect(content).toHaveClass("shadow-float");
  });

  it("dismisses the panel through PopoverClose", () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Detaily</PopoverTrigger>
        <PopoverContent>
          Obsah
          <PopoverClose>Zavřít</PopoverClose>
        </PopoverContent>
      </Popover>,
    );

    expect(screen.getByText("Obsah")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zavřít" }));

    expect(screen.queryByText("Obsah")).not.toBeInTheDocument();
  });
});

describe("Popover context guard", () => {
  it("throws a clear error when a part is used outside <Popover>", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<PopoverTrigger>x</PopoverTrigger>)).toThrow(
      /must be used within <Popover>/,
    );
    spy.mockRestore();
  });
});
