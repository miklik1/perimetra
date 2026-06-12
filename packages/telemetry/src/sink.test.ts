import { afterEach, describe, expect, it, vi } from "vitest";

import { createTelemetry } from "./create-telemetry";
import { configureTelemetry, resetTelemetry } from "./registry";
import { createLogSink } from "./sink";
import type { CaptureAdapter } from "./types";

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

afterEach(() => {
  resetTelemetry();
});

describe("createLogSink", () => {
  it("maps error → error message, warn → warning message", () => {
    const capture = fakeAdapter();
    const sink = createLogSink(createTelemetry({ capture }));

    sink.capture("error", "boom", { id: 1 });
    sink.capture("warn", "careful");

    expect(capture.captureMessage).toHaveBeenNthCalledWith(1, "boom", "error", {
      context: { id: 1 },
    });
    expect(capture.captureMessage).toHaveBeenNthCalledWith(2, "careful", "warning", undefined);
  });

  it("maps info/debug to breadcrumbs, not messages", () => {
    const capture = fakeAdapter();
    const sink = createLogSink(createTelemetry({ capture }));

    sink.capture("info", "navigated", { to: "/users" });
    sink.capture("debug", "cache hit");

    expect(capture.captureMessage).not.toHaveBeenCalled();
    expect(capture.addBreadcrumb).toHaveBeenNthCalledWith(1, {
      message: "navigated",
      category: "log",
      level: "info",
      data: { context: { to: "/users" } },
    });
    expect(capture.addBreadcrumb).toHaveBeenNthCalledWith(2, {
      message: "cache hit",
      category: "log",
      level: "info",
      data: undefined,
    });
  });

  it("without an explicit instance, resolves the facade per capture (boot-order proof)", () => {
    const sink = createLogSink(); // built BEFORE configureTelemetry, like at module load
    const capture = fakeAdapter();

    sink.capture("error", "before boot"); // hits the no-op — silent
    configureTelemetry(createTelemetry({ capture }));
    sink.capture("error", "after boot");

    expect(capture.captureMessage).toHaveBeenCalledExactlyOnceWith(
      "after boot",
      "error",
      undefined,
    );
  });
});
