import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger, setLoggerSink, type LogSink } from "./logger";

beforeEach(() => {
  // The console methods are exercised but irrelevant to most assertions.
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setLoggerSink(null);
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("gates messages below the configured level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = createLogger({ level: "info" });

    log.debug("dropped");
    log.info("kept");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledOnce();
  });

  it("routes each level to the matching console method", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger({ level: "debug" });

    log.warn("w");
    log.error("e");

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("prefixes the scope and forwards context", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = createLogger({ level: "info", scope: "api" });

    log.info("hello", { id: 1 });

    expect(infoSpy).toHaveBeenCalledWith("[api] hello", { id: 1 });
  });
});

describe("log sinks (ADR 0021)", () => {
  function fakeSink() {
    const capture = vi.fn();
    const sink: LogSink = { capture };
    return { sink, capture };
  }

  it("forwards records past the level gate to an explicit sink, not below it", () => {
    const { sink, capture } = fakeSink();
    const log = createLogger({ level: "warn", sink });

    log.info("dropped");
    log.error("kept", { code: 1 });

    expect(capture).toHaveBeenCalledExactlyOnceWith("error", "kept", { code: 1 });
  });

  it("resolves the process-wide default sink at call time (boot-order safe)", () => {
    const log = createLogger(); // built BEFORE the sink exists, like @repo/api's
    const { sink, capture } = fakeSink();

    log.warn("before boot");
    setLoggerSink(sink);
    log.warn("after boot");

    expect(capture).toHaveBeenCalledExactlyOnceWith("warn", "after boot", undefined);
  });

  it("prefers an explicit per-logger sink over the default and includes the scope", () => {
    const explicit = fakeSink();
    const fallback = fakeSink();
    setLoggerSink(fallback.sink);
    const log = createLogger({ scope: "api", sink: explicit.sink });

    log.error("boom");

    expect(explicit.capture).toHaveBeenCalledExactlyOnceWith("error", "[api] boom", undefined);
    expect(fallback.capture).not.toHaveBeenCalled();
  });
});
