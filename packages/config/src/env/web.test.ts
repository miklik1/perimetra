import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveTier } from "./web";

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

  it("rejects an invalid NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.resetModules();
    await expect(import("./web")).rejects.toThrow();
  });

  it("accepts an https API_URL in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_URL", "https://api.example.com");
    vi.resetModules();
    const { env } = await import("./web");
    expect(env.API_URL).toBe("https://api.example.com");
  });

  it("rejects an http API_URL to a remote host (https-only egress)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_URL", "http://api.example.com");
    vi.resetModules();
    await expect(import("./web")).rejects.toThrow();
  });

  // ── ADR 1021: the gate is the HOST's loopback-ness, never NODE_ENV ─────────
  it("accepts an http LOOPBACK API_URL even under NODE_ENV=production", async () => {
    // The regression that broke the gate. `next typegen` / `next build` set
    // NODE_ENV=production themselves, so the old `NODE_ENV !== "development"`
    // rule rejected the documented local API_URL (.env.example) on every
    // non-cached check-types/build — it only ever passed via a turbo cache hit,
    // and CI sets the same http://localhost:4000. Loopback traffic never
    // reaches a wire, so there is nothing to intercept.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_URL", "http://localhost:4000");
    vi.resetModules();
    const { env } = await import("./web");
    expect(env.API_URL).toBe("http://localhost:4000");
  });

  it("rejects an http REMOTE host even under NODE_ENV=development", async () => {
    // The security half, and a real tightening: the old rule allowed http to
    // ANY host once NODE_ENV was development, so a dev box pointed at a shared
    // staging backend forwarded real credentials in plaintext over a real
    // network — the exposure the rule exists to stop.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("API_URL", "http://staging.internal:4000");
    vi.resetModules();
    await expect(import("./web")).rejects.toThrow();
  });

  it.each([
    ["localhost", "http://localhost:4000"],
    ["a *.localhost subdomain (RFC 6761)", "http://api.localhost:4000"],
    ["127.0.0.1", "http://127.0.0.1:4000"],
    ["the wider 127.0.0.0/8 block", "http://127.1.2.3:4000"],
    ["IPv6 ::1", "http://[::1]:4000"],
  ])("accepts http to %s", async (_label, url) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_URL", url);
    vi.resetModules();
    const { env } = await import("./web");
    expect(env.API_URL).toBe(url);
  });

  it.each([
    // The exemption GRANTS access, so it must not be fooled by a hostname that
    // merely starts with the loopback text and resolves wherever its owner points.
    ["a hostname prefixed with 127.0.0.1", "http://127.0.0.1.evil.com:4000"],
    ["a hostname suffixed onto localhost", "http://localhost.evil.com:4000"],
    ["an out-of-range octet", "http://127.0.0.999:4000"],
    ["a non-loopback private address", "http://192.168.1.5:4000"],
    ["a non-127 loopback-looking address", "http://128.0.0.1:4000"],
  ])("rejects http to %s", async (_label, url) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("API_URL", url);
    vi.resetModules();
    await expect(import("./web")).rejects.toThrow();
  });
});

describe("resolveTier (tier derives from VERCEL_TARGET_ENV, not NODE_ENV)", () => {
  it("maps the Vercel Production environment to prod", () => {
    expect(resolveTier("production", undefined)).toBe("prod");
  });

  it("maps a Vercel Custom Environment named exactly 'stage' to stage", () => {
    expect(resolveTier("stage", undefined)).toBe("stage");
  });

  it("maps 'preview' and 'development' to preview", () => {
    expect(resolveTier("preview", undefined)).toBe("preview");
    expect(resolveTier("development", undefined)).toBe("preview");
  });

  it("fails safe: an unknown/custom env name resolves to preview (never accidentally live)", () => {
    expect(resolveTier("qa-ephemeral-42", undefined)).toBe("preview");
  });

  it("normalises casing and whitespace so a mis-cased Production target still resolves prod (never silently preview)", () => {
    // The mock-leak-to-prod direction is falling through to "preview" on a real
    // Production target; normalise so an odd-cased override can't cause it.
    expect(resolveTier("Production", undefined)).toBe("prod");
    expect(resolveTier("PRODUCTION", undefined)).toBe("prod");
    expect(resolveTier("  production\n", undefined)).toBe("prod");
    expect(resolveTier("STAGE", undefined)).toBe("stage");
  });

  it("VERCEL_TARGET_ENV wins over APP_TIER whenever present (tier is not hand-overridable on Vercel)", () => {
    expect(resolveTier("preview", "prod")).toBe("preview");
    expect(resolveTier("production", "preview")).toBe("prod");
  });

  it("falls back to APP_TIER (the non-Vercel container/standalone override) when VERCEL_TARGET_ENV is absent", () => {
    expect(resolveTier(undefined, "prod")).toBe("prod");
    expect(resolveTier(undefined, "stage")).toBe("stage");
    expect(resolveTier(undefined, "preview")).toBe("preview");
  });

  it("treats an empty-string VERCEL_TARGET_ENV as absent (so APP_TIER can still take effect)", () => {
    expect(resolveTier("", "prod")).toBe("prod");
    expect(resolveTier("", undefined)).toBe("preview");
  });

  it("defaults to preview when neither signal is set (safe local/CI default)", () => {
    expect(resolveTier(undefined, undefined)).toBe("preview");
  });
});

describe("TIER (module-load derivation)", () => {
  it("resolves to preview on a Vercel PREVIEW deploy even with NODE_ENV=production (the exact bug this fixes)", async () => {
    // Vercel sets NODE_ENV=production on preview too — the pre-fix NODE_ENV gate
    // silently killed mocks here. Tier keys off VERCEL_TARGET_ENV instead.
    vi.stubEnv("VERCEL_TARGET_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MSW", "true");
    vi.resetModules();
    const { TIER } = await import("./web");
    expect(TIER).toBe("preview");
  });

  it("resolves to prod on the Vercel Production environment", async () => {
    vi.stubEnv("VERCEL_TARGET_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_URL", "https://api.example.com");
    vi.resetModules();
    const { TIER } = await import("./web");
    expect(TIER).toBe("prod");
  });

  it("honours APP_TIER on a non-Vercel deploy (no VERCEL_TARGET_ENV)", async () => {
    vi.stubEnv("APP_TIER", "prod");
    vi.stubEnv("API_URL", "https://api.example.com");
    vi.resetModules();
    const { TIER } = await import("./web");
    expect(TIER).toBe("prod");
  });

  it("defaults to preview with neither signal set", async () => {
    vi.resetModules();
    const { TIER } = await import("./web");
    expect(TIER).toBe("preview");
  });
});
