import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NavTree, type NavTreeNode } from "./nav-tree";

const nodes: NavTreeNode[] = [
  { id: "identity", label: "Identity" },
  {
    id: "derivation",
    label: "Derivation",
    errorCount: 2,
    children: [
      { id: "derived", label: "Derived", warnCount: 1 },
      { id: "parts", label: "Parts" },
    ],
  },
];

describe("NavTree", () => {
  it("renders nodes and their children", () => {
    render(<NavTree nodes={nodes} onSelect={() => {}} />);
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Derived")).toBeInTheDocument();
    expect(screen.getByText("Parts")).toBeInTheDocument();
  });

  it("shows error/warn count badges", () => {
    render(<NavTree nodes={nodes} onSelect={() => {}} />);
    expect(screen.getByText("2")).toBeInTheDocument(); // error count
    expect(screen.getByText("1")).toBeInTheDocument(); // warn count
  });

  it("marks the selected node and fires onSelect", () => {
    const onSelect = vi.fn();
    render(<NavTree nodes={nodes} selectedId="parts" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Parts" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Identity" }));
    expect(onSelect).toHaveBeenCalledWith("identity");
  });
});
