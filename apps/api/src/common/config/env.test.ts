import { describe, expect, it } from "vitest";

import { loadEnv } from "./env.js";

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
});
