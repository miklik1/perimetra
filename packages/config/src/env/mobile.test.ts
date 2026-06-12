import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("env/mobile", () => {
  it("parses a valid EXPO_PUBLIC_API_URL", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://localhost:3000");
    vi.resetModules();
    const { env } = await import("./mobile");
    expect(env.EXPO_PUBLIC_API_URL).toBe("http://localhost:3000");
  });

  it("allows the url to be absent (optional)", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    vi.resetModules();
    const { env } = await import("./mobile");
    expect(env.EXPO_PUBLIC_API_URL).toBeUndefined();
  });

  it("throws on an invalid url", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "not-a-url");
    vi.resetModules();
    await expect(import("./mobile")).rejects.toThrow("Invalid environment variables");
  });

  it("leaves the Sentry vars undefined when absent and coerces them when set", async () => {
    vi.resetModules();
    const absent = await import("./mobile");
    expect(absent.env.EXPO_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(absent.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE).toBeUndefined();

    vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/2");
    vi.stubEnv("EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "0.1");
    vi.resetModules();
    const set = await import("./mobile");
    expect(set.env.EXPO_PUBLIC_SENTRY_DSN).toBe("https://abc@o1.ingest.sentry.io/2");
    expect(set.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
  });
});
