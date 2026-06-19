import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EnumSelect } from "./enum-select";

type Mode = "free" | "warn" | "hard";

describe("EnumSelect", () => {
  it("renders an option per choice and reflects the value", () => {
    render(
      <EnumSelect<Mode>
        value="warn"
        onChange={() => {}}
        options={[{ value: "free" }, { value: "warn", label: "Warn" }, { value: "hard" }]}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("warn");
    expect(screen.getByRole("option", { name: "Warn" })).toBeInTheDocument();
  });

  it("hands back the narrowed value on change", () => {
    const onChange = vi.fn();
    render(
      <EnumSelect<Mode>
        value="free"
        onChange={onChange}
        options={[{ value: "free" }, { value: "hard" }]}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "hard" } });
    expect(onChange).toHaveBeenCalledWith("hard");
  });
});
