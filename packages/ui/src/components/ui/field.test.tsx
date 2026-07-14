import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, Input, Textarea } from "./field";

describe("Field", () => {
  it("wires the label to the control, marks it required, and carries the brand token", () => {
    render(
      <Field required>
        <Field.Label>Šířka</Field.Label>
        <Field.Description>V milimetrech</Field.Description>
        <Field.Control>
          <Input />
        </Field.Control>
      </Field>,
    );
    // the aria-hidden asterisk is excluded from the accessible name
    const input = screen.getByRole("textbox", { name: "Šířka" });
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveClass("bg-chrome-subtle");
    // the description is wired into aria-describedby by construction
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByText("V milimetrech").id);
  });

  it("surfaces an error as an alert and marks the control invalid + described-by", () => {
    render(
      <Field>
        <Field.Label>Šířka</Field.Label>
        <Field.Control>
          <Input />
        </Field.Control>
        <Field.Error>Hodnota musí být kladná</Field.Error>
      </Field>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Hodnota musí být kladná");
    const input = screen.getByLabelText("Šířka");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("surfaces a warn as a non-blocking status (control stays valid)", () => {
    render(
      <Field>
        <Field.Label>Šířka</Field.Label>
        <Field.Control>
          <Input />
        </Field.Control>
        <Field.Warn>Neobvyklá hodnota</Field.Warn>
      </Field>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Neobvyklá hodnota");
    expect(screen.getByLabelText("Šířka")).toHaveAttribute("aria-invalid", "false");
  });

  it("joins a description and an error into one aria-describedby (multi-describer path)", () => {
    render(
      <Field>
        <Field.Label>Šířka</Field.Label>
        <Field.Description>V milimetrech</Field.Description>
        <Field.Control>
          <Input />
        </Field.Control>
        <Field.Error>Hodnota musí být kladná</Field.Error>
      </Field>,
    );
    const describedBy = screen.getByLabelText("Šířka").getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain(screen.getByText("V milimetrech").id);
    expect(describedBy).toContain(screen.getByRole("alert").id);
    // two distinct, space-joined ids — the describer list, not one clobbering the other
    expect(describedBy.trim().split(/\s+/)).toHaveLength(2);
  });

  it("wires the Textarea control the same way and carries the resize affordance", () => {
    render(
      <Field>
        <Field.Label>Poznámka</Field.Label>
        <Field.Control>
          <Textarea />
        </Field.Control>
      </Field>,
    );
    const textarea = screen.getByLabelText("Poznámka");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveClass("resize-y");
    expect(textarea).toHaveClass("bg-chrome-subtle");
  });

  it("throws when a part is used outside <Field>", () => {
    expect(() => render(<Field.Label>Šířka</Field.Label>)).toThrow(/within <Field>/);
  });
});
