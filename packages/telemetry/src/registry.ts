import { noopTelemetry } from "./no-op";
import type { Telemetry } from "./types";

/**
 * The single composition root (ADR 0021): one process-global holder, written
 * once at app boot, read by the uncontrollable edges (logger sink, error
 * boundaries, unhandled-rejection handlers). This is a facade RESOLVER, not a
 * request-scoped transport — the distinction that keeps ADR 0012 intact (the
 * Sentry SDK itself installs process globals regardless). Everything that CAN
 * take the instance explicitly (QueryClient onError, tests) still should.
 *
 * The holder lives on `globalThis` under a symbol (the `@repo/api`
 * api-log-store pattern) so it is a true singleton across Next's
 * separately-bundled module graphs (RSC vs SSR vs route handlers) — a plain
 * module-level `let` gave each graph its own copy, stranding un-booted graphs
 * on the no-op. One `configureTelemetry` per JS RUNTIME (server process,
 * browser) now covers every graph in it.
 */
const REGISTRY_KEY = Symbol.for("@repo/telemetry/registry");

interface RegistryState {
  current: Telemetry | null;
}

const globalRef = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState };
const state: RegistryState = (globalRef[REGISTRY_KEY] ??= { current: null });

/**
 * Install the app's telemetry at boot. Idempotent — the first configure wins,
 * so React StrictMode double-invocation and HMR re-runs are harmless. Tests
 * use `resetTelemetry` between cases instead of reconfiguring.
 */
export function configureTelemetry(telemetry: Telemetry): void {
  state.current ??= telemetry;
}

/** The configured telemetry, or the silent no-op before/without boot wiring. */
export function getTelemetry(): Telemetry {
  return state.current ?? noopTelemetry;
}

/** Clear the holder (tests only — production configures once per runtime). */
export function resetTelemetry(): void {
  state.current = null;
}
