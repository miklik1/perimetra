/**
 * OTel is OPT-IN by env (ADR 0036): without an exporter destination the SDK
 * never starts (no localhost:4318 connection-refused noise in dev). Standard
 * OTEL_* vars are honored natively by the NodeSDK — this gate only decides
 * whether to boot it at all.
 */
export function isOtelEnabled(): boolean {
  if (process.env.OTEL_SDK_DISABLED === "true") return false;
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    process.env.OTEL_TRACES_EXPORTER ??
    process.env.OTEL_METRICS_EXPORTER,
  );
}
