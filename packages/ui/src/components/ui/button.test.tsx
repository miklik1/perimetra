import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, buttonVariants } from "./button";

describe("buttonVariants", () => {
  it("applies the default variant + size when none are given", () => {
    const classes = buttonVariants();
    expect(classes).toContain("bg-primary");
    expect(classes).toContain("h-9");
  });

  it("composes a non-default variant and size", () => {
    const classes = buttonVariants({ variant: "destructive", size: "lg" });
    expect(classes).toContain("bg-destructive");
    expect(classes).toContain("h-10");
    expect(classes).not.toContain("bg-primary");
  });

  it("includes the pointer-coarse touch-target floor on interactive sizes (WCAG 2.5.5)", () => {
    expect(buttonVariants({ size: "default" })).toContain("pointer-coarse:min-h-11");
    expect(buttonVariants({ size: "sm" })).toContain("pointer-coarse:min-h-11");
    expect(buttonVariants({ size: "lg" })).toContain("pointer-coarse:min-h-11");
    expect(buttonVariants({ size: "icon" })).toContain("pointer-coarse:size-11");
    expect(buttonVariants({ size: "icon-sm" })).toContain("pointer-coarse:size-11");
    expect(buttonVariants({ size: "icon-lg" })).toContain("pointer-coarse:size-11");
    // The micro-sizes (inline chips) are intentionally excluded from the floor.
    expect(buttonVariants({ size: "xs" })).not.toContain("pointer-coarse");
    expect(buttonVariants({ size: "icon-xs" })).not.toContain("pointer-coarse");
  });

  it("speaks the kit's single focus grammar on every variant (ring-2 ring-ring)", () => {
    // Button was the ONE divergent focus ring in the kit (shadcn's `border-ring`
    // + `ring-[3px] ring-ring/50`). These assertions are the guard against it
    // drifting back: no variant may reintroduce a width, an opacity or a colour
    // of its own — including `destructive`, which used to tint the ring red.
    const variants = [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
      "copper",
      "copper-outline",
    ] as const;

    for (const variant of variants) {
      const classes = buttonVariants({ variant });
      expect(classes).toContain("focus-visible:ring-2");
      expect(classes).toContain("focus-visible:ring-ring");
      expect(classes).not.toContain("focus-visible:ring-[3px]");
      expect(classes).not.toContain("focus-visible:ring-ring/50");
      expect(classes).not.toContain("focus-visible:border-ring");
      expect(classes).not.toMatch(/focus-visible:ring-destructive/);
      expect(classes).not.toMatch(/dark:focus-visible:ring-/);
    }
  });

  it("gives the aria-invalid ring its own width so it paints unfocused too", () => {
    // The old `aria-invalid:ring-destructive/20` set colour only and borrowed its
    // width from the focus ring, so an invalid button was red ONLY while focused.
    const classes = buttonVariants();
    expect(classes).toContain("aria-invalid:ring-2");
    expect(classes).toContain("aria-invalid:ring-destructive");
    expect(classes).not.toContain("aria-invalid:ring-destructive/20");
    expect(classes).not.toContain("dark:aria-invalid:ring-destructive/40");
  });
});

describe("Button", () => {
  it("renders a <button> carrying the variant/size data attributes", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).toHaveAttribute("data-variant", "default");
    expect(button).toHaveAttribute("data-size", "default");
    expect(button).toHaveClass("bg-primary");
  });

  it("renders the child element instead of a button when asChild", () => {
    render(
      <Button asChild>
        <a href="/next">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("href", "/next");
    // The variant classes + slot marker are forwarded onto the child.
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link).toHaveClass("bg-primary");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lets a caller className override a conflicting variant utility (cn last-wins)", () => {
    render(<Button className="bg-red-500">Danger</Button>);
    const button = screen.getByRole("button", { name: "Danger" });
    expect(button).toHaveClass("bg-red-500");
    expect(button).not.toHaveClass("bg-primary");
  });
});
