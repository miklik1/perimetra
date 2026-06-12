import { FLAGS, type FlagKey, type FlagValue } from "./registry";
import type { Flags } from "./types";

/** Registry defaults as a flat record — the universal fallback shape. */
export function staticDefaults(): Record<FlagKey, unknown> {
  return Object.fromEntries(
    (Object.keys(FLAGS) as FlagKey[]).map((key) => [key, FLAGS[key].default]),
  ) as Record<FlagKey, unknown>;
}

/**
 * The static/default adapter (ADR 0028): serves registry defaults — SSR-safe,
 * test-safe, and the "before load / no key" value. The flags equivalent of
 * telemetry's no-op: zero config ⇒ deterministic defaults, never a crash.
 */
export function createStaticFlags(): Flags {
  return {
    isEnabled: (key) => Boolean(FLAGS[key].default),
    getValue: <K extends FlagKey>(key: K) => FLAGS[key].default as FlagValue<K>,
    getAll: staticDefaults,
  };
}
