import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ExprScope } from "@repo/model";

import { ExprEvalScopeContext, ExprField } from "./expr-field";

const scope: ExprScope = {
  known: new Set(["width_mm", "height_mm"]),
  openPrefixes: ["price."],
};

describe("ExprField", () => {
  it("shows a parse error and marks the input invalid", () => {
    render(<ExprField value="1 +" onChange={() => {}} scope={scope} aria-label="quantity" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("quantity")).toHaveAttribute("aria-invalid", "true");
  });

  it("flags an out-of-scope reference as a non-blocking warning", () => {
    render(<ExprField value="ghost" onChange={() => {}} scope={scope} aria-label="quantity" />);
    expect(screen.getByRole("status")).toHaveTextContent("will not be in scope here");
    expect(screen.getByLabelText("quantity")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows the ✓ marker for a clean in-scope expression", () => {
    render(
      <ExprField value="width_mm + 1" onChange={() => {}} scope={scope} aria-label="quantity" />,
    );
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("opens an autocomplete list and inserts the chosen candidate", () => {
    const onChange = vi.fn();
    render(<ExprField value="wid" onChange={onChange} scope={scope} aria-label="quantity" />);
    const input = screen.getByLabelText("quantity") as HTMLInputElement;
    fireEvent.focus(input);
    input.setSelectionRange(3, 3);
    fireEvent.keyUp(input, { key: "d" }); // sync the caret to the word end
    const option = screen.getByRole("option", { name: "width_mm" });
    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith("width_mm");
  });

  it("offers catalog codes as quoted-literal completions on focus and inserts one", () => {
    const onChange = vi.fn();
    render(
      <ExprField
        value=""
        onChange={onChange}
        scope={scope}
        codeSuggestions={["L50x50", "alu"]}
        aria-label="section"
      />,
    );
    fireEvent.focus(screen.getByLabelText("section"));
    fireEvent.mouseDown(screen.getByRole("option", { name: '"L50x50"' }));
    expect(onChange).toHaveBeenCalledWith('"L50x50"');
  });

  it("replaces the whole token when the caret sits mid-word (no stray tail)", () => {
    const onChange = vi.fn();
    render(
      <ExprField
        value={'"L50"'}
        onChange={onChange}
        scope={scope}
        codeSuggestions={["L50x50"]}
        aria-label="section"
      />,
    );
    const input = screen.getByLabelText("section") as HTMLInputElement;
    fireEvent.focus(input);
    input.setSelectionRange(2, 2); // caret between L and 50, inside the quotes
    fireEvent.keyUp(input, { key: "ArrowLeft" });
    fireEvent.mouseDown(screen.getByRole("option", { name: '"L50x50"' }));
    // The full token "L50" → "L50x50", not '"L50x50"50"' (stray tail) nor a doubled quote.
    expect(onChange).toHaveBeenCalledWith('"L50x50"');
  });

  it("does not double the quote when a code completion is accepted inside an open quote", () => {
    const onChange = vi.fn();
    render(
      <ExprField
        value={'"'}
        onChange={onChange}
        scope={scope}
        codeSuggestions={["alu"]}
        aria-label="material"
      />,
    );
    const input = screen.getByLabelText("material") as HTMLInputElement;
    fireEvent.focus(input);
    input.setSelectionRange(1, 1);
    fireEvent.keyUp(input, { key: '"' }); // caret after the opening quote
    fireEvent.mouseDown(screen.getByRole("option", { name: '"alu"' }));
    expect(onChange).toHaveBeenCalledWith('"alu"');
  });

  // --- Phase 4: inline =value + syntax overlay ---

  it("shows the formula's evaluated value when a live derivation scope is in context", () => {
    render(
      <ExprEvalScopeContext.Provider value={{ width_mm: 1000 }}>
        <ExprField value="width_mm / 2" onChange={() => {}} scope={scope} aria-label="quantity" />
      </ExprEvalScopeContext.Provider>,
    );
    expect(screen.getByText("= 500")).toBeInTheDocument();
  });

  it("shows no evaluated value without a scope in context", () => {
    render(
      <ExprField value="width_mm + 1" onChange={() => {}} scope={scope} aria-label="quantity" />,
    );
    expect(screen.queryByText(/^= /)).not.toBeInTheDocument();
  });

  it("renders the syntax overlay token for the source", () => {
    render(<ExprField value="max(1)" onChange={() => {}} scope={scope} aria-label="quantity" />);
    expect(screen.getByText("max")).toBeInTheDocument();
  });
});
