import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";

import { toast, toastStore } from "../lib/toast";
import { Toaster } from "./toaster";

// The <Toaster> renders the shared toast queue (ADR 0027) and owns the
// auto-dismiss timers (the store is a pure state machine — timers live in the
// render layer). These tests assert: it shows queued toasts, dismisses on the
// timer, and respects a sticky (duration 0) toast.

describe("Toaster (mobile renderer)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    toastStore.getState().clear();
  });
  afterEach(() => {
    act(() => {
      toastStore.getState().clear();
    });
    jest.useRealTimers();
  });

  it("renders nothing when the queue is empty", () => {
    render(<Toaster />);
    expect(screen.queryByText(/./)).toBeNull();
  });

  it("shows a queued toast and auto-dismisses it after its duration", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Saved", { duration: 1000 });
    });
    expect(screen.getByText("Saved")).toBeOnTheScreen();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("keeps a sticky toast (duration 0) on screen across time", () => {
    render(<Toaster />);
    act(() => {
      toastStore.getState().add({ type: "info", message: "Loading…", duration: 0 });
    });
    expect(screen.getByText("Loading…")).toBeOnTheScreen();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Loading…")).toBeOnTheScreen();
  });

  it("caps the visible toasts at the store's maxVisible", () => {
    render(<Toaster />);
    act(() => {
      for (let i = 0; i < 5; i++) toast.info(`msg-${i}`, { duration: 0 });
    });
    // Default maxVisible is 3 → the first three show, the rest stay queued.
    expect(screen.getByText("msg-0")).toBeOnTheScreen();
    expect(screen.getByText("msg-2")).toBeOnTheScreen();
    expect(screen.queryByText("msg-3")).toBeNull();
  });
});
