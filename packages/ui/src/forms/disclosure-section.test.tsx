import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DisclosureSection } from "./disclosure-section";

describe("DisclosureSection", () => {
  it("shows content when defaultOpen", () => {
    render(
      <DisclosureSection title="Deviation" defaultOpen>
        <p>bounds</p>
      </DisclosureSection>,
    );
    expect(screen.getByText("bounds")).toBeInTheDocument();
  });

  it("toggles content from the trigger", () => {
    render(
      <DisclosureSection title="Deviation">
        <p>bounds</p>
      </DisclosureSection>,
    );
    expect(screen.queryByText("bounds")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Deviation/ }));
    expect(screen.getByText("bounds")).toBeInTheDocument();
  });

  it("renders a badge slot in the header", () => {
    render(
      <DisclosureSection title="Geometry" badge={<span>3</span>}>
        <p>pieces</p>
      </DisclosureSection>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
