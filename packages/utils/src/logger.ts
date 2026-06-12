/**
 * Platform-neutral, console-backed structured logger. Level-gated; takes an
 * optional context object per call. No env import — the caller picks the level
 * (keeps `@repo/utils` free of a `@repo/config` dependency).
 *
 * Transport seam (ADR 0021): every emitted record is ALSO forwarded to a
 * `LogSink` — an explicit per-logger `sink` or the runtime-wide default set by
 * `setLoggerSink` at app boot. The interface lives here (the lower leaf) so
 * `@repo/telemetry` merely implements it and `@repo/api`'s logs reach the
 * error tracker with no `api → telemetry` edge.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Pluggable log transport. Receives every record that passes a logger's level
 * gate, after it hits the console. Implementations must never throw — the
 * logger does not guard them (observability code failing app code is worse
 * than a dropped log line).
 */
export interface LogSink {
  capture(level: LogLevel, message: string, context?: unknown): void;
}

// Runtime-wide default sink, resolved at CALL time (not logger-creation time)
// so loggers built before boot wiring — module-level `createLogger` calls in
// `@repo/api` and the `logger` singleton below — still reach a sink configured
// later. Held on `globalThis` under a symbol (the api-log-store pattern) so it
// is a true singleton across Next's separately-bundled module graphs; a plain
// module-level `let` left each graph's loggers blind to a sink registered in
// another. One boot-time write per JS runtime; the same accepted-global shape
// as the telemetry registry it usually points at (ADR 0021).
const SINK_KEY = Symbol.for("@repo/utils/logger-sink");
const globalRef = globalThis as typeof globalThis & { [SINK_KEY]?: { sink: LogSink | null } };
const sinkState = (globalRef[SINK_KEY] ??= { sink: null });

/** Set (or clear with `null`) the runtime-wide default sink. Boot-time wiring. */
export function setLoggerSink(sink: LogSink | null): void {
  sinkState.sink = sink;
}

export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

export interface CreateLoggerOptions {
  /** Minimum level to emit; lower-priority calls are dropped. Default `"info"`. */
  level?: LogLevel;
  /** Prefix tag, e.g. a package or feature name. */
  scope?: string;
  /** Explicit transport for this logger; overrides the process-wide default. */
  sink?: LogSink;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const minLevel = LEVEL_ORDER[options.level ?? "info"];
  const prefix = options.scope ? `[${options.scope}]` : undefined;

  const log = (level: LogLevel, message: string, context?: unknown): void => {
    if (LEVEL_ORDER[level] < minLevel) return;
    const head = prefix ? `${prefix} ${message}` : message;
    // Resolve the console method at call time so test spies / runtime
    // overrides of `console.*` are respected.
    if (context === undefined) console[level](head);
    else console[level](head, context);
    // Forward past the level gate; sink resolved at call time (see above).
    const sink = options.sink ?? sinkState.sink;
    sink?.capture(level, head, context);
  };

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
  };
}

/** Default shared logger instance. */
export const logger = createLogger();
