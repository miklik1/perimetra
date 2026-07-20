import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StickyActionBar } from "./sticky-action-bar";

describe("StickyActionBar", () => {
  it("sticks to the bottom and folds the safe-area inset into its own padding, not a margin", () => {
    render(
      <StickyActionBar data-testid="bar">
        <StickyActionBar.Action>
          <button type="button">Dál</button>
        </StickyActionBar.Action>
      </StickyActionBar>,
    );
    const bar = screen.getByTestId("bar");

    expect(bar).toHaveAttribute("data-slot", "sticky-action-bar");
    expect(bar).toHaveClass("sticky", "bottom-0");
    expect(bar).toHaveClass("pb-[calc(0.75rem+env(safe-area-inset-bottom))]");
  });

  it("separates itself from content scrolling underneath with a token border and elevation", () => {
    const { rerender } = render(<StickyActionBar data-testid="bar" />);
    const bar = screen.getByTestId("bar");

    expect(bar).toHaveClass("border-t", "border-border", "bg-primary", "shadow-float");
    // The ink is set on the ROOT and inherited by every part. Drop it and the bar
    // would inherit the page's ink — invisible against its own fill in one theme.
    expect(bar).toHaveClass("text-primary-foreground");

    rerender(<StickyActionBar tone="chrome" data-testid="bar" />);
    expect(screen.getByTestId("bar")).toHaveClass(
      "bg-chrome",
      "text-chrome-foreground",
      "shadow-soft-lg",
    );
  });

  it("holds its transition to the brand easing and drops it under reduced motion", () => {
    render(<StickyActionBar data-testid="bar" />);
    expect(screen.getByTestId("bar")).toHaveClass("ease-brand", "motion-reduce:transition-none");
  });

  it("derives the price + action row layout from the slots alone — no layout prop", () => {
    render(
      <StickyActionBar>
        <StickyActionBar.Price data-testid="price">
          <span>Total</span>
          <span className="font-data">48 250</span>
        </StickyActionBar.Price>
        <StickyActionBar.Action data-testid="action">
          <button type="button">Save</button>
        </StickyActionBar.Action>
      </StickyActionBar>,
    );

    expect(screen.getByTestId("price")).toHaveAttribute("data-slot", "sticky-action-bar-price");
    // The action trails the price rather than stretching, because it is not first.
    expect(screen.getByTestId("action")).toHaveClass("justify-end");
    expect(screen.getByTestId("price").nextElementSibling).toBe(screen.getByTestId("action"));
  });

  it("lets the action stretch full width when no price slot is filled", () => {
    render(
      <StickyActionBar>
        <StickyActionBar.Action data-testid="action">
          <button type="button">Dál</button>
        </StickyActionBar.Action>
      </StickyActionBar>,
    );
    const action = screen.getByTestId("action");

    // Being :first-child is the WHOLE switch — the consumer passes nothing extra.
    // Assert the DOM position rather than the class string, so renaming the
    // utility that implements the stretch doesn't fail a layout-contract test.
    expect(action.parentElement?.firstElementChild).toBe(action);
    // ...and it is a real first-child-scoped rule, not a static one that would
    // also stretch the action when a price precedes it.
    expect(Array.from(action.classList).some((c) => c.includes(":first-child"))).toBe(true);
  });

  it("places the note on its own line below the row and tones it by string, not booleans", () => {
    const { rerender } = render(
      <StickyActionBar>
        <StickyActionBar.Action>
          <button type="button">Dál</button>
        </StickyActionBar.Action>
        <StickyActionBar.Note>Ready</StickyActionBar.Note>
      </StickyActionBar>,
    );
    const note = screen.getByText("Ready");

    expect(note).toHaveAttribute("data-slot", "sticky-action-bar-note");
    expect(note).toHaveClass("basis-full", "text-ui-sm", "opacity-70");

    rerender(
      <StickyActionBar>
        <StickyActionBar.Note tone="destructive">Broken</StickyActionBar.Note>
      </StickyActionBar>,
    );
    expect(screen.getByText("Broken")).toHaveAttribute("data-tone", "destructive");
  });

  it("derives note ink against the bar's own ink so it tracks the light/dark inversion", () => {
    // The bar fill INVERTS between themes (--color-primary near-black -> near-white)
    // while --color-warning does not, so a bare `text-warning` collapses to 1.93:1
    // in dark. Mixing toward currentColor keeps every combination above 4.5:1.
    const { rerender } = render(
      <StickyActionBar>
        <StickyActionBar.Note tone="warning">Pozor</StickyActionBar.Note>
      </StickyActionBar>,
    );
    const note = screen.getByText(/Pozor/);

    expect(note).not.toHaveClass("text-warning");
    expect(note).toHaveClass("text-[color-mix(in_oklab,var(--color-warning)_55%,currentColor)]");

    rerender(
      <StickyActionBar>
        <StickyActionBar.Note tone="success">Hotovo</StickyActionBar.Note>
      </StickyActionBar>,
    );
    expect(screen.getByText(/Hotovo/)).toHaveClass(
      "text-[color-mix(in_oklab,var(--color-success)_55%,currentColor)]",
    );
  });

  it("carries the tone in a glyph and a live region, never in colour alone", () => {
    const { rerender } = render(
      <StickyActionBar>
        <StickyActionBar.Note tone="destructive">Selhalo</StickyActionBar.Note>
      </StickyActionBar>,
    );
    const note = screen.getByRole("alert");

    expect(note).toHaveTextContent("Selhalo");
    const glyph = note.querySelector('[data-slot="sticky-action-bar-note-icon"]');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph?.querySelector("svg")).not.toBeNull();

    // Non-destructive statuses announce politely rather than interrupting.
    rerender(
      <StickyActionBar>
        <StickyActionBar.Note tone="success">Uloženo</StickyActionBar.Note>
      </StickyActionBar>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Uloženo");

    // A muted hint is not a status at all — no live region, no glyph.
    rerender(
      <StickyActionBar>
        <StickyActionBar.Note>Tip</StickyActionBar.Note>
      </StickyActionBar>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByText("Tip").querySelector('[data-slot="sticky-action-bar-note-icon"]'),
    ).toBeNull();
  });

  it("lets an explicit NoteIcon replace the default glyph rather than adding a second one", () => {
    render(
      <StickyActionBar>
        <StickyActionBar.Note tone="warning">
          <StickyActionBar.NoteIcon>!</StickyActionBar.NoteIcon>
          Bez ceníku
        </StickyActionBar.Note>
      </StickyActionBar>,
    );
    const note = screen.getByRole("status");
    const glyphs = note.querySelectorAll('[data-slot="sticky-action-bar-note-icon"]');

    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]).toHaveTextContent("!");
    expect(glyphs[0]?.querySelector("svg")).toBeNull();
  });

  it("throws a branded error when NoteIcon is rendered outside a Note", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <StickyActionBar>
          <StickyActionBar.NoteIcon />
        </StickyActionBar>,
      ),
    ).toThrow("<StickyActionBar.NoteIcon> must be rendered inside <StickyActionBar.Note>.");
    spy.mockRestore();
  });

  it("spreads props onto the parts, so events and a11y attributes reach the DOM", () => {
    const onClick = vi.fn();
    render(
      <StickyActionBar aria-label="Akce">
        <StickyActionBar.Action>
          <button type="button" onClick={onClick}>
            Vytvořit
          </button>
        </StickyActionBar.Action>
      </StickyActionBar>,
    );

    screen.getByRole("button", { name: "Vytvořit" }).click();
    expect(onClick).toHaveBeenCalledOnce();
    // role="group" is what makes the label REAL: ARIA prohibits aria-label on
    // role=generic, so querying by role here (not just by label text, which
    // testing-library reads straight off the attribute) is the honest assertion.
    expect(screen.getByRole("group", { name: "Akce" })).toHaveAttribute(
      "data-slot",
      "sticky-action-bar",
    );
  });

  it.each(["Price", "Action", "Note"] as const)(
    "throws a branded error when %s is rendered outside <StickyActionBar>",
    (part) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const Part = StickyActionBar[part];
      expect(() => render(<Part />)).toThrow(
        `<StickyActionBar.${part}> must be rendered inside <StickyActionBar>.`,
      );
      spy.mockRestore();
    },
  );
});
