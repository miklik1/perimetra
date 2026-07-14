import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("renders the spotlight surface carrying the brand token classes (ADR 0111)", () => {
    render(
      <StatCard>
        <StatCard.Metric>13</StatCard.Metric>
        <StatCard.Label>Cestující</StatCard.Label>
      </StatCard>,
    );
    const root = screen.getByText("13").closest("[data-slot='stat-card']");
    expect(root).not.toBeNull();
    expect(root).toHaveClass("bg-spotlight");
    expect(root).toHaveClass("rounded-card-lg");
    expect(screen.getByText("13")).toHaveClass("font-data");
  });

  it("fires onClick on the action and forwards its aria-label", async () => {
    const onClick = vi.fn();
    render(
      <StatCard>
        <StatCard.Action aria-label="Otevřít detail" onClick={onClick} />
      </StatCard>,
    );
    const action = screen.getByRole("button", { name: "Otevřít detail" });
    expect(action).toHaveClass("bg-spotlight-foreground/15");
    action.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("throws a clear error when a part is rendered outside <StatCard>", () => {
    // The context guard: a stray slot must not render unstyled in the wild.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<StatCard.Metric>13</StatCard.Metric>)).toThrow(
      "<StatCard.Metric> must be rendered inside <StatCard>.",
    );
    spy.mockRestore();
  });
});
