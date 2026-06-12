/** Throws with `message` when `condition` is falsy; narrows the type otherwise. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Exhaustiveness guard for discriminated unions / switch statements. */
export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}

/** Type guard that narrows away `null` and `undefined`. */
export const isDefined = <T>(value: T | null | undefined): value is T => value != null;
