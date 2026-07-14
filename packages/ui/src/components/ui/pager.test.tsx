import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Pager } from "./pager";

describe("Pager", () => {
  it("fires the step handlers and carries the chrome-pill brand token", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Pager onPrev={onPrev} onNext={onNext} label="2 / 4" />);

    const prev = screen.getByRole("button", { name: "Předchozí" });
    const next = screen.getByRole("button", { name: "Další" });
    // Default Czech aria-labels resolve both buttons; the label renders between.
    expect(screen.getByText("2 / 4")).toHaveAttribute("data-slot", "pager-label");
    expect(prev.className).toContain("rounded-full");
    expect(prev.className).toContain("bg-chrome");

    prev.click();
    next.click();
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("reflects the can-step edges as disabled and honours custom aria-labels", () => {
    const onPrev = vi.fn();
    render(
      <Pager onPrev={onPrev} onNext={vi.fn()} canPrev={false} prevLabel="Zpět" nextLabel="Vpřed" />,
    );

    const prev = screen.getByRole("button", { name: "Zpět" });
    expect(prev).toBeDisabled();
    expect(screen.getByRole("button", { name: "Vpřed" })).toBeEnabled();
    // A disabled button never dispatches the click, so the handler stays cold.
    prev.click();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it("omits the center label when none is given", () => {
    render(<Pager onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(document.querySelector("[data-slot='pager-label']")).toBeNull();
  });
});
