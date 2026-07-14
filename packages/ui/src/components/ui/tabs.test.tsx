import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function Fixture() {
  return (
    <Tabs defaultValue="a">
      <TabsList aria-label="Sekce">
        <TabsTrigger value="a">První</TabsTrigger>
        <TabsTrigger value="b">Druhá</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Obsah A</TabsContent>
      <TabsContent value="b">Obsah B</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("shows the default panel on a brand chrome track (Radix unmounts the inactive one)", () => {
    render(<Fixture />);
    expect(screen.getByText("Obsah A")).toBeInTheDocument();
    expect(screen.queryByText("Obsah B")).not.toBeInTheDocument();
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("data-slot", "tabs-list");
    expect(list.className).toContain("bg-chrome");
  });

  it("switches the visible panel and flips the active-fill token on selection", () => {
    render(<Fixture />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Druhá" }));
    expect(screen.getByText("Obsah B")).toBeInTheDocument();
    const active = screen.getByRole("tab", { name: "Druhá" });
    expect(active).toHaveAttribute("data-state", "active");
    expect(active.className).toContain("data-[state=active]:bg-nav-active");
  });

  it("throws a clear error when a part is used outside <Tabs> (Radix owns the context)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TabsTrigger value="a">Orphan</TabsTrigger>)).toThrow(
      /must be used within/i,
    );
    spy.mockRestore();
  });
});
