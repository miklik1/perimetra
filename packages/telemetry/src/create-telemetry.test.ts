import { describe, expect, it, vi } from "vitest";

import { createTelemetry } from "./create-telemetry";
import { noopAnalytics } from "./no-op";
import type { Analytics, CaptureAdapter } from "./types";

function fakeAdapter() {
  const capture: CaptureAdapter = {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
    setUser: vi.fn(),
    startSpan: vi.fn((_name, fn) => fn()),
    flush: vi.fn(() => Promise.resolve(true)),
  };
  return capture;
}

describe("createTelemetry", () => {
  it("routes capture calls to the adapter", () => {
    const capture = fakeAdapter();
    const telemetry = createTelemetry({ capture });
    const error = new Error("boom");

    telemetry.captureException(error, { path: "/users" });
    telemetry.captureMessage("bad", "error", { code: 1 });
    telemetry.addBreadcrumb({ message: "clicked" });
    telemetry.setUser({ id: "u1" });

    expect(capture.captureException).toHaveBeenCalledExactlyOnceWith(error, { path: "/users" });
    expect(capture.captureMessage).toHaveBeenCalledExactlyOnceWith("bad", "error", { code: 1 });
    expect(capture.addBreadcrumb).toHaveBeenCalledExactlyOnceWith({ message: "clicked" });
    expect(capture.setUser).toHaveBeenCalledExactlyOnceWith({ id: "u1" });
  });

  it("startSpan passes through the function's return value", () => {
    const telemetry = createTelemetry({ capture: fakeAdapter() });
    expect(telemetry.startSpan("calc", () => 42)).toBe(42);
  });

  it("defaults analytics to the no-op and accepts a custom adapter", () => {
    expect(createTelemetry({ capture: fakeAdapter() }).analytics).toBe(noopAnalytics);

    const analytics: Analytics = {
      trackEvent: vi.fn(),
      screen: vi.fn(),
      identify: vi.fn(),
      reset: vi.fn(),
    };
    const telemetry = createTelemetry({ capture: fakeAdapter(), analytics });
    telemetry.analytics.trackEvent("signup", { plan: "pro" });
    expect(analytics.trackEvent).toHaveBeenCalledExactlyOnceWith("signup", { plan: "pro" });
  });
});
