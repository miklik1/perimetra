import type { LogSink } from "@repo/utils";

import { getTelemetry } from "./registry";
import type { Telemetry } from "./types";

/**
 * Bridge the `@repo/utils` logger to telemetry (ADR 0021): warn/error records
 * become messages (Sentry issues), info/debug become breadcrumbs (context on
 * the next event). Registered once at boot via `setLoggerSink(createLogSink())`
 * — this routes app AND `@repo/api` logs without an `api → telemetry` edge.
 */
export function createLogSink(telemetry?: Telemetry): LogSink {
  // Default to resolving the facade PER CAPTURE, not at creation: the logger
  // sink is one of the "uncontrollable edges" the registry exists for, and the
  // lazy lookup makes boot ordering (sink vs configureTelemetry) irrelevant.
  // Pass an instance explicitly in tests or non-global setups.
  const resolve = telemetry ? () => telemetry : getTelemetry;
  return {
    capture(level, message, context) {
      const target = resolve();
      const extra = context === undefined ? undefined : { context };
      if (level === "error") target.captureMessage(message, "error", extra);
      else if (level === "warn") target.captureMessage(message, "warning", extra);
      else target.addBreadcrumb({ message, category: "log", level: "info", data: extra });
    },
  };
}
