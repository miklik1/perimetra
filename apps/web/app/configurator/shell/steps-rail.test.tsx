import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { StepsRail, type RailItem } from "./steps-rail";

/**
 * The rail owns three things and nothing else: it maps `RailItem[]` onto the
 * kit's `StepNav` compound, marks exactly one item current, and reports
 * selections back by key. Assertions are semantic (roles, accessible names,
 * `aria-current`) so the ADR 0114 styling stays free to move.
 */

const items: RailItem[] = [
  { key: "produkt:produkt", label: "Produkt", sub: "Brána posuvná", done: true },
  { key: "release:rozmery", label: "Rozměry", sub: "4 000 × 1 800", done: true },
  { key: "release:vypln", label: "Výplň", sub: "Lamela 90 mm", done: false },
  { key: "barva:barva", label: "Povrch a barva", done: false },
  { key: "souhrn:souhrn", label: "Shrnutí", done: false },
];

function renderRail(overrides: Partial<React.ComponentProps<typeof StepsRail>> = {}) {
  const onSelect = vi.fn();
  render(
    <I18nProvider locale="cs" messages={cs}>
      <StepsRail items={items} activeKey="release:vypln" onSelect={onSelect} {...overrides} />
    </I18nProvider>,
  );
  return { onSelect };
}

describe("StepsRail", () => {
  it("names the navigation landmark from the catalog", () => {
    renderRail();
    // The rail is a real landmark, not an anonymous column of buttons.
    const nav = screen.getByRole("navigation", { name: cs.configurator.configuration });
    expect(nav).toBeTruthy();
    // …and still shows the caption visually.
    expect(within(nav).getByText(cs.configurator.configuration)).toBeTruthy();
  });

  it("renders one keyboard-operable button per item, in order", () => {
    renderRail();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(items.length);
    // Native buttons: Tab reaches them and Enter/Space activate them for free.
    for (const button of buttons) expect(button.tagName).toBe("BUTTON");

    buttons[0]!.focus();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("carries the value echo inside the item's accessible name", () => {
    renderRail();
    // `sub` is supplementary — the label is always present alongside it. Matched
    // loosely because the separator between the two spans is a layout detail
    // (they blockify as flex items in a browser; jsdom evaluates no container
    // query, so it concatenates them tighter than a real AT would).
    expect(screen.getByRole("button", { name: /Rozměry.*4 000 × 1 800/ })).toBeTruthy();
  });

  it("names an echo-less item by its label alone", () => {
    renderRail();
    expect(screen.getByRole("button", { name: "Shrnutí" })).toBeTruthy();
  });

  it("marks exactly the active item as the current step", () => {
    renderRail();
    const current = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Výplň");
  });

  it("moves the current step when activeKey changes", () => {
    renderRail({ activeKey: "produkt:produkt" });
    expect(screen.getByRole("button", { name: /Produkt/ }).getAttribute("aria-current")).toBe(
      "step",
    );
    expect(screen.getByRole("button", { name: /Výplň/ }).getAttribute("aria-current")).toBe(null);
  });

  it("flags completed steps as done and leaves the rest unflagged", () => {
    renderRail();
    expect(screen.getByRole("button", { name: /Produkt/ }).getAttribute("data-state")).toBe("done");
    expect(screen.getByRole("button", { name: /Výplň/ }).getAttribute("data-state")).toBe(null);
  });

  it("reports the selected step by key", () => {
    const { onSelect } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: /Povrch a barva/ }));
    expect(onSelect).toHaveBeenCalledWith("barva:barva");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("still reports a click on the already-active step", () => {
    // Re-selecting is the caller's decision to ignore, not the rail's to swallow.
    const { onSelect } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: /Výplň/ }));
    expect(onSelect).toHaveBeenCalledWith("release:vypln");
  });

  it("renders nothing but the caption for an empty step list", () => {
    renderRail({ items: [] });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("navigation", { name: cs.configurator.configuration })).toBeTruthy();
  });
});
