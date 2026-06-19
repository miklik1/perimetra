import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DefectList } from "./defect-list";

describe("DefectList", () => {
  it("renders where · code and the message per defect", () => {
    render(
      <DefectList
        defects={[
          { code: "ref.unknown", where: "derived[d1]", message: '"d2" will not be in scope here' },
        ]}
      />,
    );
    expect(screen.getByText("derived[d1] · ref.unknown")).toBeInTheDocument();
    expect(screen.getByText('"d2" will not be in scope here')).toBeInTheDocument();
  });

  it("navigates by where on click", () => {
    const onSelect = vi.fn();
    render(
      <DefectList
        onSelect={onSelect}
        defects={[{ code: "expr.parse", where: "parts[cap].bom.quantity", message: "Expected )" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("parts[cap].bom.quantity");
  });

  it("shows the empty label when there are no defects", () => {
    render(<DefectList defects={[]} emptyLabel="No problems" />);
    expect(screen.getByText("No problems")).toBeInTheDocument();
  });
});
