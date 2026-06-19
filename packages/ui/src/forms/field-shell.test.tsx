import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FieldShell } from "./field-shell";

describe("FieldShell", () => {
  it("links the label and control and exposes ids to the render prop", () => {
    render(
      <FieldShell label="Width">
        {({ fieldId, invalid }) => <input id={fieldId} aria-invalid={invalid} defaultValue="x" />}
      </FieldShell>,
    );
    const input = screen.getByLabelText("Width");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("surfaces an error as an alert and marks the field invalid + described-by", () => {
    render(
      <FieldShell label="Width" error="must be positive">
        {({ fieldId, describedById, invalid }) => (
          <input id={fieldId} aria-describedby={describedById} aria-invalid={invalid} />
        )}
      </FieldShell>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("must be positive");
    const input = screen.getByLabelText("Width");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("surfaces a warn as a non-blocking status (field stays valid)", () => {
    render(
      <FieldShell label="Width" warn="unusual value">
        {({ fieldId, invalid }) => <input id={fieldId} aria-invalid={invalid} />}
      </FieldShell>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("unusual value");
    expect(screen.getByLabelText("Width")).toHaveAttribute("aria-invalid", "false");
  });
});
