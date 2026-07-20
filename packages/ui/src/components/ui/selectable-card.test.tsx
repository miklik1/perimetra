import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { SelectableCard } from "./selectable-card";

function Families({
  value,
  onValueChange = () => {},
}: {
  value?: string;
  onValueChange?: (v: string) => void;
}) {
  return (
    <SelectableCard.Group value={value} onValueChange={onValueChange} aria-label="Rodina produktu">
      <SelectableCard value="posuvna">
        <SelectableCard.Title>Posuvná brána</SelectableCard.Title>
        <SelectableCard.Description>Do 6 m průjezdu</SelectableCard.Description>
      </SelectableCard>
      <SelectableCard value="kridlova">
        <SelectableCard.Title>Křídlová brána</SelectableCard.Title>
      </SelectableCard>
      <SelectableCard value="samonosna" disabled>
        <SelectableCard.Title>Samonosná brána</SelectableCard.Title>
        <SelectableCard.Badge tone="outline">Připravujeme</SelectableCard.Badge>
      </SelectableCard>
    </SelectableCard.Group>
  );
}

/** Controlled wrapper, so keyboard selection is observable end to end. */
function Controlled() {
  const [value, setValue] = React.useState<string | undefined>("posuvna");
  return <Families value={value} onValueChange={setValue} />;
}

describe("SelectableCard.Group", () => {
  it("is a real radiogroup of real radios — never divs with onClick", () => {
    render(<Families value="posuvna" />);

    const group = screen.getByRole("radiogroup", { name: "Rodina produktu" });
    expect(group).toBeInTheDocument();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio.tagName).toBe("BUTTON");
  });

  it("reflects the selected value as aria-checked, not as a style-only cue", () => {
    render(<Families value="kridlova" />);

    expect(screen.getByRole("radio", { name: /Křídlová/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Posuvná/ })).toHaveAttribute("aria-checked", "false");
  });

  it("takes its accessible name from Title even when Title is visually hidden (the swatch case)", () => {
    // The colour swatch fills only Visual; the label is a SLOT rendered sr-only.
    // This is also the fix for the export's broken `RAL pozink` title template.
    render(
      <SelectableCard.Group value="7016" aria-label="Odstín">
        <SelectableCard value="7016">
          <SelectableCard.Visual>
            <span data-testid="chip" />
          </SelectableCard.Visual>
          <SelectableCard.Title className="sr-only">
            RAL 7016 — antracitová šedá
          </SelectableCard.Title>
        </SelectableCard>
        <SelectableCard value="pozink">
          <SelectableCard.Visual>
            <span />
          </SelectableCard.Visual>
          <SelectableCard.Title className="sr-only">Pozink</SelectableCard.Title>
        </SelectableCard>
      </SelectableCard.Group>,
    );

    expect(screen.getByRole("radio", { name: "RAL 7016 — antracitová šedá" })).toBeInTheDocument();
    // Not "RAL pozink" — the label is authored, not interpolated from the key.
    expect(screen.getByRole("radio", { name: "Pozink" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "RAL pozink" })).toBeNull();
  });

  it("never uses the native title attribute for a label (design/README.md §12.2)", () => {
    render(<Families value="posuvna" />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toHaveAttribute("title");
    }
  });

  it("selects on click and reports the value", () => {
    const onValueChange = vi.fn();
    render(<Families value="posuvna" onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /Křídlová/ }));
    expect(onValueChange).toHaveBeenCalledWith("kridlova");
  });

  it("is one tab stop — the checked option holds it, the others are -1", () => {
    render(<Families value="kridlova" />);

    expect(screen.getByRole("radio", { name: /Křídlová/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /Posuvná/ })).toHaveAttribute("tabindex", "-1");
  });

  it("stays keyboard-reachable when nothing is selected yet — the first option holds the tab stop", () => {
    render(<Families value={undefined} />);
    expect(screen.getByRole("radio", { name: /Posuvná/ })).toHaveAttribute("tabindex", "0");
  });

  it("moves focus and selection with arrow keys", () => {
    render(<Controlled />);

    const posuvna = screen.getByRole("radio", { name: /Posuvná/ });
    posuvna.focus();
    fireEvent.keyDown(posuvna, { key: "ArrowRight" });

    const kridlova = screen.getByRole("radio", { name: /Křídlová/ });
    expect(kridlova).toHaveFocus();
    expect(kridlova).toHaveAttribute("aria-checked", "true");
  });

  it("focuses a disabled option so it stays discoverable, but never selects it", () => {
    render(<Controlled />);

    const posuvna = screen.getByRole("radio", { name: /Posuvná/ });
    posuvna.focus();
    fireEvent.keyDown(posuvna, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("radio", { name: /Křídlová/ }), { key: "ArrowRight" });

    const soon = screen.getByRole("radio", { name: /Samonosná/ });
    // Discoverable: focus lands on it and it is NOT natively disabled.
    expect(soon).toHaveFocus();
    expect(soon).toHaveAttribute("aria-disabled", "true");
    expect(soon).not.toBeDisabled();
    // But selection stayed behind.
    expect(soon).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /Křídlová/ })).toHaveAttribute("aria-checked", "true");
  });

  it("ignores clicks on a disabled option", () => {
    const onValueChange = vi.fn();
    render(<Families value="posuvna" onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /Samonosná/ }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("wraps around at both ends", () => {
    render(<Controlled />);

    const posuvna = screen.getByRole("radio", { name: /Posuvná/ });
    posuvna.focus();
    fireEvent.keyDown(posuvna, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: /Samonosná/ })).toHaveFocus();
  });
});

describe("SelectableCard composition guards", () => {
  it("throws when a card is rendered outside its group", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SelectableCard value="x">x</SelectableCard>)).toThrow(
      /must be rendered inside <SelectableCard.Group>/,
    );
    spy.mockRestore();
  });

  it("throws when a slot is rendered outside a card", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<SelectableCard.Title>x</SelectableCard.Title>)).toThrow(
      /<SelectableCard.Title> must be rendered inside <SelectableCard>/,
    );
    spy.mockRestore();
  });
});
