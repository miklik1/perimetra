import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KeyValueList } from "./key-value-list";

describe("KeyValueList", () => {
  it("renders a semantic description list so a screen reader pairs key with value", () => {
    render(
      <KeyValueList data-testid="kv">
        <KeyValueList.Row label="Rozměr">4 000 × 1 800 mm</KeyValueList.Row>
      </KeyValueList>,
    );

    const list = screen.getByTestId("kv");
    expect(list.tagName).toBe("DL");
    expect(list).toHaveAttribute("data-slot", "key-value-list");

    const key = screen.getByText("Rozměr");
    const value = screen.getByText("4 000 × 1 800 mm");
    expect(key.tagName).toBe("DT");
    expect(value.tagName).toBe("DD");
    expect(key.parentElement).toBe(value.parentElement);
  });

  it("puts the separator on the root as a :not(:last-child) rule, never on a row", () => {
    // The "no rule after the last row" guarantee is structural — rows carry no
    // divider class of their own, so call sites cannot get the count wrong.
    render(
      <KeyValueList data-testid="kv">
        <KeyValueList.Row label="A">1</KeyValueList.Row>
        <KeyValueList.Row label="B">2</KeyValueList.Row>
      </KeyValueList>,
    );

    const list = screen.getByTestId("kv");
    expect(list).toHaveClass("[&>*:not(:last-child)]:border-b");

    for (const row of list.querySelectorAll("[data-slot='key-value-list-row']")) {
      expect(row.className).not.toMatch(/border-b/);
    }
  });

  it("defaults the value to the aligning numeric register and switches to mono on request", () => {
    render(
      <KeyValueList>
        <KeyValueList.Row label="Cena">48 250 Kč</KeyValueList.Row>
        <KeyValueList.Row label="Profil" mono>
          AL-PRF-40
        </KeyValueList.Row>
      </KeyValueList>,
    );

    const numeric = screen.getByText("48 250 Kč");
    expect(numeric).toHaveAttribute("data-register", "data");
    expect(numeric).toHaveClass("font-data", "tabular-nums");

    const code = screen.getByText("AL-PRF-40");
    expect(code).toHaveAttribute("data-register", "mono");
    expect(code).toHaveClass("font-mono");
    expect(code).not.toHaveClass("tabular-nums");
  });

  it("accepts a ReactNode label, not just a string", () => {
    render(
      <KeyValueList>
        <KeyValueList.Row label={<span data-testid="rich">Šířka (mm)</span>}>4000</KeyValueList.Row>
      </KeyValueList>,
    );

    expect(screen.getByTestId("rich").closest("dt")).not.toBeNull();
  });

  it("lets a long value wrap without moving the key column", () => {
    render(
      <KeyValueList>
        <KeyValueList.Row label="Poznámka">{"x".repeat(400)}</KeyValueList.Row>
      </KeyValueList>,
    );

    expect(screen.getByText("Poznámka")).toHaveClass("shrink-0");
    expect(screen.getByText("x".repeat(400))).toHaveClass("min-w-0", "flex-1", "break-words");
  });

  it("forwards arbitrary props to the row element", () => {
    render(
      <KeyValueList>
        <KeyValueList.Row label="Rozměr" data-testid="row" id="dim">
          4000
        </KeyValueList.Row>
      </KeyValueList>,
    );

    expect(screen.getByTestId("row")).toHaveAttribute("id", "dim");
  });

  it("throws a clear error when a row is rendered outside <KeyValueList>", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<KeyValueList.Row label="Rozměr">4000</KeyValueList.Row>)).toThrow(
      "<KeyValueList.Row> must be rendered inside <KeyValueList>.",
    );
    spy.mockRestore();
  });
});
