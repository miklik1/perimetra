import { afterEach, describe, expect, it, vi } from "vitest";

import { createTelemetry } from "./create-telemetry";
import { noopCaptureAdapter, noopTelemetry } from "./no-op";
import { configureTelemetry, getTelemetry, resetTelemetry } from "./registry";

afterEach(() => {
  resetTelemetry();
});

describe("telemetry registry", () => {
  it("returns the no-op before anything is configured", () => {
    expect(getTelemetry()).toBe(noopTelemetry);
    // …and the no-op is genuinely inert.
    expect(() => getTelemetry().captureException(new Error("x"))).not.toThrow();
    expect(getTelemetry().startSpan("s", () => "ok")).toBe("ok");
  });

  it("returns the configured instance after boot wiring", () => {
    const telemetry = createTelemetry({ capture: noopCaptureAdapter });
    configureTelemetry(telemetry);
    expect(getTelemetry()).toBe(telemetry);
  });

  it("is idempotent — the first configure wins (StrictMode/HMR safe)", () => {
    const first = createTelemetry({ capture: noopCaptureAdapter });
    const second = createTelemetry({ capture: noopCaptureAdapter });
    configureTelemetry(first);
    configureTelemetry(second);
    expect(getTelemetry()).toBe(first);
  });

  it("resetTelemetry clears the holder (tests only)", () => {
    configureTelemetry(createTelemetry({ capture: noopCaptureAdapter }));
    resetTelemetry();
    expect(getTelemetry()).toBe(noopTelemetry);
    vi.restoreAllMocks();
  });
});
