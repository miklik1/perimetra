import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Toast, toastVariants, ToastViewport } from "./toast";

describe("toastVariants", () => {
  it("defaults to the info variant", () => {
    expect(toastVariants()).toContain("border-border");
  });

  it("uses the destructive border for the error variant", () => {
    expect(toastVariants({ variant: "error" })).toContain("border-destructive/50");
  });
});

describe("ToastViewport", () => {
  it("is a polite aria-live region", () => {
    render(<ToastViewport>content</ToastViewport>);
    const region = screen.getByText("content");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("data-slot", "toast-viewport");
  });
});

describe("Toast", () => {
  it("renders the message, title, and variant data attribute", () => {
    render(
      <Toast variant="success" title="Done">
        Saved your changes
      </Toast>,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Saved your changes")).toBeInTheDocument();
    expect(screen.getByText("Done").closest("[data-slot='toast']")).toHaveAttribute(
      "data-variant",
      "success",
    );
  });

  it("renders an action button only when both label and handler are given", () => {
    const onAction = vi.fn();
    const { rerender } = render(<Toast>No action</Toast>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(
      <Toast actionLabel="Undo" onAction={onAction}>
        With action
      </Toast>,
    );
    const button = screen.getByRole("button", { name: "Undo" });
    button.click();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("renders a labelled dismiss control when a dismiss handler is given", () => {
    const onDismiss = vi.fn();
    render(
      <Toast dismissLabel="Dismiss" onDismiss={onDismiss}>
        Closeable
      </Toast>,
    );
    const close = screen.getByRole("button", { name: "Dismiss" });
    close.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("gives both interactive controls the pointer-coarse touch-target floor (WCAG 2.5.5)", () => {
    render(
      <Toast actionLabel="Undo" onAction={vi.fn()} dismissLabel="Dismiss" onDismiss={vi.fn()}>
        Both controls
      </Toast>,
    );
    // Mirrors `button.test.tsx`: the floor is a class contract, so assert the
    // classes. jsdom computes no layout, so a measured 44px is unavailable here.
    expect(screen.getByRole("button", { name: "Undo" }).className).toContain(
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByRole("button", { name: "Dismiss" }).className).toContain(
      "pointer-coarse:size-11",
    );
  });
});
