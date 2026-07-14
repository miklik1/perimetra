import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Separator, Skeleton, Spinner } from "./skeleton";

describe("Skeleton", () => {
  it("is sized by the caller's className while keeping the brand pulse token (ADR 0111)", () => {
    render(<Skeleton className="h-8 w-40" data-testid="sk" />);
    const sk = screen.getByTestId("sk");

    expect(sk).toHaveAttribute("data-slot", "skeleton");
    expect(sk).toHaveClass("animate-pulse", "rounded-control", "bg-muted", "h-8", "w-40");
  });
});

describe("Spinner", () => {
  it("exposes an accessible status role with a Czech default label that props override", () => {
    const { rerender } = render(<Spinner />);
    const spinner = screen.getByRole("status");

    expect(spinner).toHaveAttribute("aria-label", "Načítání");
    expect(spinner).toHaveClass("animate-spin", "text-muted-foreground");

    rerender(<Spinner aria-label="Ukládání" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Ukládání");
  });
});

describe("Separator", () => {
  it("defaults to a decorative horizontal rule and passes orientation/decorative through", () => {
    const { rerender } = render(<Separator data-testid="sep" />);
    const sep = screen.getByTestId("sep");

    expect(sep).toHaveAttribute("data-slot", "separator");
    expect(sep).toHaveAttribute("data-orientation", "horizontal");
    expect(sep).toHaveClass("bg-border");

    rerender(<Separator orientation="vertical" decorative={false} data-testid="sep" />);
    const semantic = screen.getByRole("separator");
    expect(semantic).toHaveAttribute("data-orientation", "vertical");
  });
});
