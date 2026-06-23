/**
 * The two-tier auth rate-limit guard (ADR 0044). `authRateLimitConfig.max` is a
 * per-request function: the high-frequency session-management flow on
 * `/get-session` — the GET read AND the client's POST session-refresh — gets the
 * generous tier; every credential POST stays on the strict tier.
 *
 * The narrowness cases are the security-load-bearing ones — they prove the
 * generous tier is reachable ONLY by the exact `GET …/get-session` path, never
 * by a raw-URL substring (`POST /sign-in/email?x=/get-session` must NOT steal
 * the generous tier — that would be a ~30× brute-force bypass), a trailing
 * slash, or a sibling read (`list-sessions`).
 */
import { type FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { type Env } from "../config/env.js";
import { authRateLimitConfig } from "./throttle.module.js";

const STRICT = 10;
const GENEROUS = 300;

const env = {
  AUTH_RATE_LIMIT_MAX: STRICT,
  AUTH_SESSION_RATE_LIMIT_MAX: GENEROUS,
} as unknown as Env;

/** The `max` function only reads `method` and `url` off the request. */
function tierFor(method: string, url: string): number {
  const { max } = authRateLimitConfig(env).rateLimit;
  return max({ method, url } as FastifyRequest);
}

describe("authRateLimitConfig — two-tier selection", () => {
  it("GET /get-session → the generous session-read tier", () => {
    expect(tierFor("GET", "/api/auth/get-session")).toBe(GENEROUS);
  });

  it("GET /get-session with a query string → still the generous tier (query stripped)", () => {
    expect(tierFor("GET", "/api/auth/get-session?disableCookieCache=true")).toBe(GENEROUS);
  });

  it("POST /get-session → the generous tier (Better Auth client session-refresh)", () => {
    expect(tierFor("POST", "/api/auth/get-session")).toBe(GENEROUS);
  });

  it("POST /sign-in/email → the strict credential tier", () => {
    expect(tierFor("POST", "/api/auth/sign-in/email")).toBe(STRICT);
  });

  it("POST /sign-in/email?x=/get-session → STRICT (no raw-URL substring bypass)", () => {
    expect(tierFor("POST", "/api/auth/sign-in/email?x=/get-session")).toBe(STRICT);
  });

  // ---- narrowness: the generous tier is path-exact, GET-only ----------------

  it("GET /get-session/ (trailing slash) → STRICT (suffix match is exact)", () => {
    expect(tierFor("GET", "/api/auth/get-session/")).toBe(STRICT);
  });

  it("GET /list-sessions → STRICT (sibling read is not whitelisted)", () => {
    expect(tierFor("GET", "/api/auth/list-sessions")).toBe(STRICT);
  });
});
