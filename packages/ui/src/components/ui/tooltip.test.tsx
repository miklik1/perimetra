import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

// radix's Popper positions an open bubble via floating-ui, which reaches for
// ResizeObserver/IntersectionObserver — neither exists in jsdom. Stub both so an
// `open` tooltip can mount and we can assert the real rendered content.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ObserverStub);
  vi.stubGlobal("IntersectionObserver", ObserverStub);
});

describe("Tooltip", () => {
  it("renders the trigger and, when open, an ink-bubble content carrying the brand token", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Rozměr</TooltipTrigger>
          <TooltipContent>Rozměr v milimetrech</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Rozměr" });
    expect(trigger).toHaveAttribute("data-slot", "tooltip-trigger");

    // The visible bubble is radix's PopperPrimitive.Content (the role="tooltip"
    // node is a visually-hidden a11y duplicate), so address it by our data-slot.
    const content = document.querySelector<HTMLElement>("[data-slot='tooltip-content']");
    expect(content).toBeInTheDocument();
    expect(content).toHaveClass("bg-nav-active", "shadow-float");
    expect(content).toHaveTextContent("Rozměr v milimetrech");
  });
});

describe("Tooltip context guard", () => {
  it("throws a clear error when a part is used outside <Tooltip> (radix's own context)", () => {
    // No parallel context is stacked (mirrors Popover/Tabs) — radix's Trigger
    // context throws when there's no enclosing <Tooltip> root.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TooltipTrigger>x</TooltipTrigger>)).toThrow(/must be used within/);
    spy.mockRestore();
  });
});
