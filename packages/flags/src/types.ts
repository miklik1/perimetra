import type { FlagKey, FlagValue } from "./registry";

/**
 * The vendor-agnostic flags contract (ADR 0028). App code depends on this
 * interface (or the React hooks over it), never on a PostHog SDK — swappable,
 * fakeable in tests, SSR/tree-shake-safe. Synchronous by design: client
 * adapters answer from already-loaded state and fall back to registry
 * defaults; per-request ASYNC server evaluation lives behind the separate
 * `./web/server` surface (`getFlag`/`getAllFlags`/`getBootstrap`).
 */
export interface Flags {
  isEnabled(key: FlagKey): boolean;
  getValue<K extends FlagKey>(key: K): FlagValue<K>;
  getAll(): Record<FlagKey, unknown>;
}

/**
 * Server-evaluated seed for the client (ADR 0028 "no flag flash"): the RSC
 * layer evaluates flags for the request's distinct id and hands the result to
 * `FlagsProvider`, which both renders from it immediately and passes it to
 * `posthog.init({ bootstrap })` so the SDK starts aligned with the server.
 * Field names match posthog-js's `bootstrap` option (capital ID).
 */
export interface FlagsBootstrap {
  distinctID: string;
  /** `false` for anonymous/generated ids; identity arrives via `identify`. */
  isIdentifiedID: boolean;
  featureFlags: Record<string, boolean | string>;
}
