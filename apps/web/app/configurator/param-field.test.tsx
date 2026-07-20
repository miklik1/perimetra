import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { expr, type OptionSet, type ParameterDef, type Value } from "@repo/model";

import { ParamField } from "./param-field";

/**
 * Characterisation suite for the generated form field (CORE_SPEC §8). The
 * component is shared by the configurator wizard AND the release editor's
 * Preview tab, so a behaviour change is silent in one of them. Everything here
 * asserts SEMANTICS — control kind, accessible name, emitted value and its
 * runtime type — never class names or DOM shape, so a restyle passes unchanged.
 */

function param(over: Partial<ParameterDef> & Pick<ParameterDef, "key" | "type">): ParameterDef {
  return { adjustability: "user", ...over };
}

function renderField(
  def: ParameterDef,
  opts: {
    optionSets?: OptionSet[];
    value?: Value | undefined;
    effective?: Value | undefined;
    onChange?: Mock<(value: Value | undefined) => void>;
  } = {},
) {
  const onChange: Mock<(value: Value | undefined) => void> = opts.onChange ?? vi.fn();
  const view = render(
    <I18nProvider locale="cs" messages={cs}>
      <ParamField
        def={def}
        optionSets={opts.optionSets ?? []}
        value={opts.value}
        effective={opts.effective}
        onChange={onChange}
      />
    </I18nProvider>,
  );
  return { onChange, ...view };
}

const fillOptions: OptionSet = {
  key: "fill",
  selectedBy: "fill_type_id",
  options: [
    { id: "planka_100_2d", label: "PLAŇKA 100 2D", attrs: {} },
    { id: "lamela_113_3d", label: "Lamela 113 3D", attrs: {} },
    { id: "no_label", attrs: {} },
  ],
};

describe("ParamField — type → control mapping", () => {
  it("renders length_mm as a number input and suffixes the unit on the label", () => {
    renderField(param({ key: "opening_width_mm", type: "length_mm", label: "Šířka otvoru" }), {
      value: 4000,
    });
    const input = screen.getByLabelText(/Šířka otvoru/);
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveValue(4000);
    // The "(mm)" unit hint is part of the label's accessible name.
    expect(screen.getByLabelText("Šířka otvoru (mm)")).toBe(input);
  });

  it("renders int as a number input WITHOUT the mm unit hint", () => {
    renderField(param({ key: "leaf_count", type: "int", label: "Počet křídel" }), { value: 2 });
    const input = screen.getByLabelText("Počet křídel");
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveValue(2);
  });

  it("mirrors a range domain onto the number input's min/max/step", () => {
    renderField(
      param({
        key: "opening_width_mm",
        type: "length_mm",
        label: "Šířka",
        domain: { kind: "range", min: 1000, max: 6000, step: 50 },
      }),
      { value: 4000 },
    );
    const input = screen.getByLabelText(/Šířka/);
    expect(input).toHaveAttribute("min", "1000");
    expect(input).toHaveAttribute("max", "6000");
    expect(input).toHaveAttribute("step", "50");
  });

  it("renders bool as a checkbox reflecting the shown value", () => {
    renderField(param({ key: "has_lock", type: "bool", label: "Zámek" }), { value: true });
    const box = screen.getByRole("checkbox", { name: "Zámek" });
    expect(box).toBeChecked();
  });

  it("renders an unchecked checkbox when the bool value is absent", () => {
    renderField(param({ key: "has_lock", type: "bool", label: "Zámek" }));
    expect(screen.getByRole("checkbox", { name: "Zámek" })).not.toBeChecked();
  });

  it("renders text as a text input", () => {
    renderField(param({ key: "note", type: "text", label: "Poznámka" }), { value: "abc" });
    const input = screen.getByLabelText("Poznámka");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("abc");
  });

  it("falls back to a text input for color and multiselect (no dedicated control today)", () => {
    const { unmount } = renderField(param({ key: "ral", type: "color", label: "Barva" }), {
      value: "RAL 7016",
    });
    expect(screen.getByLabelText("Barva")).toHaveAttribute("type", "text");
    unmount();

    renderField(param({ key: "extras", type: "multiselect", label: "Doplňky" }), { value: "a" });
    expect(screen.getByLabelText("Doplňky")).toHaveAttribute("type", "text");
  });

  it("falls back to a text input for a select type with neither option set nor enum domain", () => {
    renderField(param({ key: "fill_type_id", type: "select", label: "Typ výplně" }));
    expect(screen.getByLabelText("Typ výplně")).toHaveAttribute("type", "text");
  });
});

describe("ParamField — labels", () => {
  it("renders the vendor-authored label", () => {
    renderField(param({ key: "opening_width_mm", type: "text", label: "Šířka otvoru" }));
    expect(screen.getByLabelText("Šířka otvoru")).toBeInTheDocument();
  });

  it("falls back to the parameter key when no label is authored", () => {
    renderField(param({ key: "opening_width_mm", type: "text" }));
    expect(screen.getByLabelText("opening_width_mm")).toBeInTheDocument();
  });

  it("falls back to the key AND still appends the unit hint for length_mm", () => {
    renderField(param({ key: "opening_width_mm", type: "length_mm" }));
    expect(screen.getByLabelText("opening_width_mm (mm)")).toBeInTheDocument();
  });
});

describe("ParamField — option sets", () => {
  it("renders vendor option labels in authored order, plus a leading empty option", () => {
    renderField(param({ key: "fill_type_id", type: "select", label: "Typ výplně" }), {
      optionSets: [fillOptions],
      value: "planka_100_2d",
    });
    // Query by ROLE, not tagName: a native <select> and the kit's Radix trigger
    // both expose role="combobox", so this survives a restyle that swaps one for
    // the other. `tagName === "SELECT"` would not.
    const select = screen.getByRole("combobox", { name: "Typ výplně" });
    expect(select).toHaveValue("planka_100_2d");

    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(["", "planka_100_2d", "lamela_113_3d", "no_label"]);
    expect(options.map((o) => o.textContent)).toEqual([
      "",
      "PLAŇKA 100 2D",
      "Lamela 113 3D",
      // An option without a vendor label shows its id.
      "no_label",
    ]);
  });

  it("only matches the option set whose selectedBy is this parameter's key", () => {
    renderField(param({ key: "other_param", type: "select", label: "Jiný" }), {
      optionSets: [fillOptions],
    });
    expect(screen.getByLabelText("Jiný")).toHaveAttribute("type", "text");
  });

  it("emits the option id as a string", () => {
    const { onChange } = renderField(
      param({ key: "fill_type_id", type: "select", label: "Typ výplně" }),
      { optionSets: [fillOptions], value: "planka_100_2d" },
    );
    fireEvent.change(screen.getByLabelText("Typ výplně"), {
      target: { value: "lamela_113_3d" },
    });
    expect(onChange).toHaveBeenCalledWith("lamela_113_3d");
  });

  it("emits undefined when the empty option is picked", () => {
    const { onChange } = renderField(
      param({ key: "fill_type_id", type: "select", label: "Typ výplně" }),
      { optionSets: [fillOptions], value: "planka_100_2d" },
    );
    fireEvent.change(screen.getByLabelText("Typ výplně"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("takes precedence over an enum domain on the same parameter", () => {
    renderField(
      param({
        key: "fill_type_id",
        type: "select",
        label: "Typ výplně",
        domain: { kind: "enum", values: ["x", "y"] },
      }),
      { optionSets: [fillOptions] },
    );
    const values = (screen.getAllByRole("option") as HTMLOptionElement[]).map((o) => o.value);
    expect(values).toContain("planka_100_2d");
    expect(values).not.toContain("x");
  });

  it("loses to bool — a bool parameter stays a checkbox even with a matching option set", () => {
    renderField(param({ key: "fill_type_id", type: "bool", label: "Výplň?" }), {
      optionSets: [fillOptions],
      value: true,
    });
    expect(screen.getByRole("checkbox", { name: "Výplň?" })).toBeChecked();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

describe("ParamField — enum domain selects", () => {
  it("renders the enum values in authored order as their own labels", () => {
    renderField(
      param({
        key: "hand",
        type: "select",
        label: "Strana",
        domain: { kind: "enum", values: ["left", "right"] },
      }),
      { value: "right" },
    );
    const select = screen.getByLabelText("Strana");
    expect(select).toHaveValue("right");
    expect((screen.getAllByRole("option") as HTMLOptionElement[]).map((o) => o.value)).toEqual([
      "",
      "left",
      "right",
    ]);
  });

  it("emits a string for a non-numeric enum parameter", () => {
    const { onChange } = renderField(
      param({
        key: "hand",
        type: "select",
        label: "Strana",
        domain: { kind: "enum", values: ["left", "right"] },
      }),
      { value: "left" },
    );
    fireEvent.change(screen.getByLabelText("Strana"), { target: { value: "right" } });
    expect(onChange).toHaveBeenCalledWith("right");
  });

  it("emits a NUMBER for a numeric enum parameter (int / length_mm)", () => {
    const { onChange } = renderField(
      param({
        key: "post_count",
        type: "int",
        label: "Počet sloupků",
        domain: { kind: "enum", values: ["2", "3", "4"] },
      }),
      { value: 2 },
    );
    fireEvent.change(screen.getByLabelText("Počet sloupků"), { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith(3);
    expect(typeof onChange.mock.calls[0]![0]).toBe("number");
  });

  it("emits undefined when the empty option is picked, for numeric enums too", () => {
    const { onChange } = renderField(
      param({
        key: "post_count",
        type: "int",
        label: "Počet sloupků",
        domain: { kind: "enum", values: ["2", "3"] },
      }),
      { value: 2 },
    );
    fireEvent.change(screen.getByLabelText("Počet sloupků"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("ignores a pattern domain (stays the type's default control)", () => {
    renderField(
      param({
        key: "code",
        type: "text",
        label: "Kód",
        domain: { kind: "pattern", pattern: "^A" },
      }),
    );
    expect(screen.getByLabelText("Kód")).toHaveAttribute("type", "text");
  });
});

describe("ParamField — change propagation and typing", () => {
  it("emits a number from a number input, not a string", () => {
    const { onChange } = renderField(
      param({ key: "opening_width_mm", type: "length_mm", label: "Šířka" }),
      { value: 4000 },
    );
    fireEvent.change(screen.getByLabelText(/Šířka/), { target: { value: "4600" } });
    expect(onChange).toHaveBeenCalledWith(4600);
    expect(typeof onChange.mock.calls[0]![0]).toBe("number");
  });

  it("emits undefined when a number input is cleared (hand back to the default)", () => {
    const { onChange } = renderField(
      param({ key: "opening_width_mm", type: "length_mm", label: "Šířka" }),
      { value: 4000 },
    );
    fireEvent.change(screen.getByLabelText(/Šířka/), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("emits a string from a text input and undefined when cleared", () => {
    const { onChange } = renderField(param({ key: "note", type: "text", label: "Poznámka" }), {
      value: "abc",
    });
    const input = screen.getByLabelText("Poznámka");
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(onChange).toHaveBeenLastCalledWith("xyz");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("emits booleans from the checkbox — never undefined", () => {
    const { onChange } = renderField(param({ key: "has_lock", type: "bool", label: "Zámek" }), {
      value: true,
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Zámek" }));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(typeof onChange.mock.calls[0]![0]).toBe("boolean");
  });
});

describe("ParamField — default (post-cascade) value display", () => {
  it("shows the effective value and a default badge when the user has typed nothing", () => {
    renderField(param({ key: "opening_width_mm", type: "length_mm", label: "Šířka" }), {
      effective: 4000,
    });
    expect(screen.getByLabelText(/Šířka/)).toHaveValue(4000);
    expect(screen.getByText(cs.configurator.defaultBadge)).toBeInTheDocument();
  });

  it("hides the badge once the user value is present, even if it equals the effective one", () => {
    renderField(param({ key: "opening_width_mm", type: "length_mm", label: "Šířka" }), {
      value: 4000,
      effective: 4000,
    });
    expect(screen.queryByText(cs.configurator.defaultBadge)).not.toBeInTheDocument();
  });

  it("shows no badge and an empty control when neither value nor effective exists", () => {
    renderField(param({ key: "opening_width_mm", type: "length_mm", label: "Šířka" }));
    expect(screen.getByLabelText(/Šířka/)).toHaveValue(null);
    expect(screen.queryByText(cs.configurator.defaultBadge)).not.toBeInTheDocument();
  });

  it("the user value wins over the effective value", () => {
    renderField(param({ key: "opening_width_mm", type: "length_mm", label: "Šířka" }), {
      value: 4600,
      effective: 4000,
    });
    expect(screen.getByLabelText(/Šířka/)).toHaveValue(4600);
  });

  it("clearing hands the field back to the default: badge returns on the re-render", () => {
    const onChange: Mock<(value: Value | undefined) => void> = vi.fn();
    const def = param({ key: "opening_width_mm", type: "length_mm", label: "Šířka" });
    const { rerender } = renderField(def, { value: 4600, effective: 4000, onChange });
    fireEvent.change(screen.getByLabelText(/Šířka/), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);

    // The parent drops the user value; the field falls back to the engine default.
    rerender(
      <I18nProvider locale="cs" messages={cs}>
        <ParamField
          def={def}
          optionSets={[]}
          value={undefined}
          effective={4000}
          onChange={onChange}
        />
      </I18nProvider>,
    );
    expect(screen.getByLabelText(/Šířka/)).toHaveValue(4000);
    expect(screen.getByText(cs.configurator.defaultBadge)).toBeInTheDocument();
  });

  it("shows the effective option in an option-set select when nothing is typed", () => {
    renderField(param({ key: "fill_type_id", type: "select", label: "Typ výplně" }), {
      optionSets: [fillOptions],
      effective: "lamela_113_3d",
    });
    expect(screen.getByLabelText(/Typ výplně/)).toHaveValue("lamela_113_3d");
    expect(screen.getByText(cs.configurator.defaultBadge)).toBeInTheDocument();
  });

  it("keeps the badge inside the label, so it joins the control's accessible name", () => {
    // Locked as-is: the badge sits in the <label>, so the accessible name is
    // "<label> <badge>". A restyle that moves the badge out of the label
    // changes the accessible name — that must be a deliberate, visible change.
    renderField(param({ key: "opening_width_mm", type: "int", label: "Počet" }), { effective: 2 });
    expect(screen.getByLabelText(new RegExp(cs.configurator.defaultBadge))).toHaveValue(2);
    expect(screen.getByLabelText(/Počet/)).toHaveValue(2);
  });
});

describe("ParamField — deviation note", () => {
  it("renders the vendor deviation note when present", () => {
    renderField(
      param({
        key: "opening_width_mm",
        type: "length_mm",
        label: "Šířka",
        deviation: { mode: "warn", note: "Nad 6 m úhlopříčka prověsí." },
      }),
    );
    expect(screen.getByText("Nad 6 m úhlopříčka prověsí.")).toBeInTheDocument();
  });

  it("renders nothing extra when the deviation carries no note", () => {
    renderField(
      param({
        key: "opening_width_mm",
        type: "length_mm",
        label: "Šířka",
        deviation: { mode: "hard" },
      }),
    );
    expect(screen.getByLabelText(/Šířka/)).toBeInTheDocument();
    expect(screen.queryByText(/prověsí/)).not.toBeInTheDocument();
  });
});

describe("ParamField — what the component does NOT do today", () => {
  // Locked deliberately: the reskin must not silently gain (or lose) these.
  it("never disables or marks read-only, whatever the adjustability (I7 is enforced upstream)", () => {
    for (const adjustability of ["vendor", "tenant", "user"] as const) {
      const { unmount } = renderField(
        param({ key: "opening_width_mm", type: "length_mm", label: "Šířka", adjustability }),
        { value: 4000 },
      );
      const input = screen.getByLabelText(/Šířka/);
      expect(input).toBeEnabled();
      expect(input).not.toHaveAttribute("readonly");
      unmount();
    }
  });

  it("wires no aria-invalid / aria-describedby error state (issues render in the results panel)", () => {
    renderField(
      param({
        key: "opening_width_mm",
        type: "length_mm",
        label: "Šířka",
        domain: { kind: "range", min: 1000, max: 6000 },
        deviation: { mode: "hard", note: "Mimo rozsah." },
      }),
      { value: 99999 },
    );
    const input = screen.getByLabelText(/Šířka/);
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("does not filter on relevance — that gating happens in the wizard", () => {
    renderField(
      param({
        key: "opening_width_mm",
        type: "length_mm",
        label: "Šířka",
        relevance: expr("false"),
      }),
      { value: 4000 },
    );
    expect(screen.getByLabelText(/Šířka/)).toBeInTheDocument();
  });
});
