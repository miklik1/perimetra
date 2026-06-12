import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { toast, toastStore } from "../lib/toast";
import { Toaster } from "./toaster";

function renderToaster() {
  return render(
    <I18nProvider locale="en" messages={en}>
      <Toaster />
    </I18nProvider>,
  );
}

describe("Toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastStore.getState().clear();
  });
  afterEach(() => {
    act(() => toastStore.getState().clear());
    vi.useRealTimers();
  });

  it("renders a queued toast inside an aria-live viewport", () => {
    renderToaster();
    act(() => {
      toast.success("Saved");
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    // The viewport is the live region.
    expect(screen.getByText("Saved").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });

  it("uses role=alert for errors and role=status otherwise", () => {
    renderToaster();
    act(() => {
      toast.error("Boom");
      toast.info("FYI");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    expect(screen.getByRole("status")).toHaveTextContent("FYI");
  });

  it("auto-dismisses a non-sticky toast after its duration", () => {
    renderToaster();
    act(() => {
      toast.info("Transient", { duration: 1000 });
    });
    expect(screen.getByText("Transient")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Transient")).not.toBeInTheDocument();
    expect(toastStore.getState().toasts).toHaveLength(0);
  });

  it("keeps a sticky (duration 0) toast on screen", () => {
    renderToaster();
    act(() => {
      toast.info("Loading", { duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("invokes the action callback when the action button is clicked", () => {
    const onAction = vi.fn();
    renderToaster();
    act(() => {
      toast.info("Undo me", { duration: 0, action: { label: "Undo", onAction } });
    });
    act(() => {
      screen.getByRole("button", { name: "Undo" }).click();
    });
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("dismisses when the close control is clicked", () => {
    renderToaster();
    act(() => {
      toast.info("Close me", { duration: 0 });
    });
    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).click();
    });
    expect(screen.queryByText("Close me")).not.toBeInTheDocument();
  });
});
