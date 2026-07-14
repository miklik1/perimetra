import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the compound slots with their data-slot markers + brand tokens", () => {
    render(
      <EmptyState>
        <EmptyState.Icon data-testid="icon">
          <svg viewBox="0 0 24 24" />
        </EmptyState.Icon>
        <EmptyState.Title>Zatím žádné nabídky</EmptyState.Title>
        <EmptyState.Description>Vytvořte první nabídku a objeví se zde.</EmptyState.Description>
      </EmptyState>,
    );

    const icon = screen.getByTestId("icon");
    expect(icon).toHaveAttribute("data-slot", "empty-state-icon");
    // the muted circular chrome badge — a semantic surface token, never raw hex
    expect(icon).toHaveClass("bg-chrome-subtle");
    expect(icon).toHaveClass("rounded-full");

    const title = screen.getByText("Zatím žádné nabídky");
    expect(title).toHaveAttribute("data-slot", "empty-state-title");
    expect(title).toHaveClass("font-display");
  });

  it("renders the Action slot's button and forwards interaction to it", () => {
    const onClick = vi.fn();
    render(
      <EmptyState>
        <EmptyState.Action>
          <button type="button" onClick={onClick}>
            Nová nabídka
          </button>
        </EmptyState.Action>
      </EmptyState>,
    );
    screen.getByRole("button", { name: "Nová nabídka" }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("throws a clear error when a part is rendered outside <EmptyState>", () => {
    // The context guard: a stray slot must not render unstyled in the wild.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<EmptyState.Title>Orphan</EmptyState.Title>)).toThrow(
      "<EmptyState.Title> must be rendered inside <EmptyState>.",
    );
    spy.mockRestore();
  });
});
