import { fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { ArrayField } from "./array-field";

interface Row {
  name: string;
}

function Harness({ reorderable = true }: { reorderable?: boolean }) {
  const { control } = useForm<{ items: Row[] }>({
    defaultValues: { items: [{ name: "a" }, { name: "b" }] },
  });
  return (
    <ArrayField
      control={control}
      name="items"
      makeDefault={() => ({ name: "new" })}
      addLabel="Add row"
      reorderable={reorderable}
    >
      {({ index }) => <span data-testid="row">{index}</span>}
    </ArrayField>
  );
}

describe("ArrayField", () => {
  it("renders a row per field", () => {
    render(<Harness />);
    expect(screen.getAllByTestId("row")).toHaveLength(2);
  });

  it("appends a row on add", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(screen.getAllByTestId("row")).toHaveLength(3);
  });

  it("removes a row", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByLabelText("Remove")[0]!);
    expect(screen.getAllByTestId("row")).toHaveLength(1);
  });

  it("disables move-up on the first row and move-down on the last", () => {
    render(<Harness />);
    const up = screen.getAllByLabelText("Move up");
    const down = screen.getAllByLabelText("Move down");
    expect(up[0]).toBeDisabled();
    expect(down[down.length - 1]).toBeDisabled();
  });

  it("hides reorder controls when not reorderable", () => {
    render(<Harness reorderable={false} />);
    expect(screen.queryByLabelText("Move up")).not.toBeInTheDocument();
  });
});
