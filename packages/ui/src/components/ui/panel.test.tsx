import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Panel } from "./panel";

describe("Panel", () => {
  it("keeps its pre-parts defaults so existing panels are untouched (ADR 0114 §9.4)", () => {
    // The parts are strictly additive. If this drifts, ~20 shipped panels move.
    render(<Panel data-testid="p">obsah</Panel>);
    const panel = screen.getByTestId("p");

    expect(panel).toHaveAttribute("data-slot", "panel");
    expect(panel).toHaveClass("rounded-card", "bg-chrome", "shadow-soft", "p-5");
  });

  it("composes a header/body/footer without a layout prop", () => {
    render(
      <Panel padded={false}>
        <Panel.Header>
          <Panel.Title>Výplň</Panel.Title>
          <Panel.Meta>krok 3 ze 7</Panel.Meta>
        </Panel.Header>
        <Panel.Body>pole</Panel.Body>
        <Panel.Footer>akce</Panel.Footer>
      </Panel>,
    );

    expect(screen.getByText("Výplň")).toHaveAttribute("data-slot", "panel-title");
    expect(screen.getByText("krok 3 ze 7")).toHaveAttribute("data-slot", "panel-meta");
    expect(screen.getByText("pole")).toHaveAttribute("data-slot", "panel-body");
    expect(screen.getByText("akce")).toHaveAttribute("data-slot", "panel-footer");
  });

  it("uses the UI type ramp, not the stock Tailwind sizes", () => {
    // text-ui-lg is 15px; stock text-lg is 18px. Getting this wrong is invisible
    // in review and wrong on every screen.
    render(
      <Panel>
        <Panel.Title>T</Panel.Title>
      </Panel>,
    );
    expect(screen.getByText("T")).toHaveClass("text-ui-lg", "font-display");
  });

  it("throws when a part escapes its panel", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Panel.Header>x</Panel.Header>)).toThrow(
      /<Panel.Header> must be rendered inside <Panel>/,
    );
    spy.mockRestore();
  });
});
