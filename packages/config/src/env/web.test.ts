import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env/web", () => {
  it("validates without throwing and exposes a valid NODE_ENV", async () => {
    const { env } = await import("./web");
    expect(["development", "test", "production"]).toContain(env.NODE_ENV);
  });

  it("leaves the Sentry vars undefined when absent (no-op telemetry path)", async () => {
    const { env } = await import("./web");
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE).toBeUndefined();
    expect(env.SENTRY_AUTH_TOKEN).toBeUndefined();
  });

  it("parses and coerces the Sentry vars when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/1");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENVIRONMENT", "production");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "0.2");
    vi.resetModules();
    const { env } = await import("./web");
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBe("https://abc@o1.ingest.sentry.io/1");
    expect(env.NEXT_PUBLIC_SENTRY_ENVIRONMENT).toBe("production");
    expect(env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE).toBe(0.2);
  });

  it("rejects an out-of-range traces sample rate", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "1.5");
    vi.resetModules();
    await expect(import("./web")).rejects.toThrow();
  });
});
