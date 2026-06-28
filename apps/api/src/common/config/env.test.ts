import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.js";

/** A production env with every guarded secret overridden to a strong value. */
const STRONG_PRODUCTION = {
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "x".repeat(32),
  CENTRIFUGO_TOKEN_SECRET: "y".repeat(32),
  CENTRIFUGO_API_KEY: "a-real-centrifugo-api-key",
  BULL_BOARD_PASSWORD: "a-real-bull-board-password",
} as const;

describe("loadEnv", () => {
  it("applies dev defaults on an empty env", () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_URL).toContain("postgres://");
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.BODY_LIMIT_BYTES).toBe(1_048_576);
  });

  it("fails fast with readable issues on invalid values", () => {
    expect(() => loadEnv({ PORT: "not-a-port" })).toThrow(/PORT/);
  });

  it("parses TRUST_PROXY as a boolean", () => {
    expect(loadEnv({ TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
  });

  it("applies auth + redis dev defaults", () => {
    const env = loadEnv({});
    expect(env.BETTER_AUTH_SECRET).toBe("dev-secret-change-me");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:4000");
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
  });

  it("rejects malformed auth URLs", () => {
    expect(() => loadEnv({ BETTER_AUTH_URL: "not-a-url" })).toThrow(/BETTER_AUTH_URL/);
    expect(() => loadEnv({ WEB_ORIGIN: "not-a-url" })).toThrow(/WEB_ORIGIN/);
  });

  it("rejects dev-placeholder secrets under NODE_ENV=production", () => {
    // Every secret still on its publicly-known dev default — boot must crash.
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects a too-short signing secret in production", () => {
    expect(() => loadEnv({ ...STRONG_PRODUCTION, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("boots in production once every guarded secret is overridden with a strong value", () => {
    const env = loadEnv({ ...STRONG_PRODUCTION });
    expect(env.NODE_ENV).toBe("production");
    expect(env.BETTER_AUTH_SECRET).toBe("x".repeat(32));
  });

  it("requires a strong bull-board password only when the board is enabled in production", () => {
    // Disabled (the default) → a weak / placeholder password is irrelevant; the board never mounts.
    expect(() => loadEnv({ ...STRONG_PRODUCTION, BULL_BOARD_PASSWORD: "admin" })).not.toThrow();
    // Enabled with the weak default → rejected.
    expect(() =>
      loadEnv({ ...STRONG_PRODUCTION, BULL_BOARD_ENABLED: "true", BULL_BOARD_PASSWORD: "admin" }),
    ).toThrow(/BULL_BOARD_PASSWORD/);
    // Enabled with a strong password → accepted.
    expect(() =>
      loadEnv({
        ...STRONG_PRODUCTION,
        BULL_BOARD_ENABLED: "true",
        BULL_BOARD_PASSWORD: "y".repeat(20),
      }),
    ).not.toThrow();
  });

  it("does not enforce the secret guard outside production", () => {
    // Same placeholder secrets, but development → defaults stand, no throw.
    expect(loadEnv({}).BETTER_AUTH_SECRET).toBe("dev-secret-change-me");
    expect(loadEnv({ NODE_ENV: "test" }).CENTRIFUGO_API_KEY).toBe("dev-centrifugo-api-key");
  });
});
