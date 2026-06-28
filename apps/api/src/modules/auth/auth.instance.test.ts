/**
 * Session-policy config guard (ADR 0033): the signed cookie-cache window is the
 * ban/revoke/erasure SLA, so it must be env-driven (not the old hardcoded 300s)
 * and switch off at 0. Builds the instance against fakes and reads the resolved
 * `options` — no DB/Redis is touched.
 */
import { describe, expect, it } from "vitest";

import { createAuth, type CreateAuthDeps } from "./auth.instance.js";

const fakeDb = {} as CreateAuthDeps["db"];
const fakeRedis = {
  get: () => null,
  getdel: () => null,
  set: () => null,
  del: () => null,
} as unknown as CreateAuthDeps["redis"];
const fakeEmail: CreateAuthDeps["email"] = {
  sendVerificationEmail: async () => {},
  // perimetra requires the org-invitation hook too (ADR 0057).
  sendInvitationEmail: async () => {},
};
const fakeLogger: CreateAuthDeps["logger"] = { log: () => {} };

function makeEnv(overrides: Record<string, unknown> = {}): CreateAuthDeps["env"] {
  return {
    NODE_ENV: "development",
    BETTER_AUTH_SECRET: "dev-secret-change-me",
    BETTER_AUTH_URL: "http://localhost:4000",
    WEB_ORIGIN: "http://localhost:3000",
    SESSION_COOKIE_CACHE_MAX_AGE_S: 60,
    ...overrides,
  } as unknown as CreateAuthDeps["env"];
}

interface ResolvedSession {
  expiresIn: number;
  updateAge: number;
  cookieCache: { enabled: boolean; maxAge: number };
}

function sessionOptions(env: CreateAuthDeps["env"]): ResolvedSession {
  const auth = createAuth({
    db: fakeDb,
    redis: fakeRedis,
    env,
    email: fakeEmail,
    logger: fakeLogger,
  });
  return (auth as unknown as { options: { session: ResolvedSession } }).options.session;
}

describe("createAuth — session policy", () => {
  it("drives the signed cookieCache window from SESSION_COOKIE_CACHE_MAX_AGE_S (default 60s, not the old hardcoded 300)", () => {
    const { cookieCache } = sessionOptions(makeEnv());
    expect(cookieCache.enabled).toBe(true);
    expect(cookieCache.maxAge).toBe(60);
    expect(cookieCache.maxAge).toBeLessThanOrEqual(60);
  });

  it("disables the cookieCache when SESSION_COOKIE_CACHE_MAX_AGE_S=0 (every getSession reads fresh)", () => {
    const { cookieCache } = sessionOptions(makeEnv({ SESSION_COOKIE_CACHE_MAX_AGE_S: 0 }));
    expect(cookieCache.enabled).toBe(false);
    expect(cookieCache.maxAge).toBe(0);
  });

  it("sets an explicit session lifetime policy (7-day expiry, 1-day sliding refresh)", () => {
    const session = sessionOptions(makeEnv());
    expect(session.expiresIn).toBe(60 * 60 * 24 * 7);
    expect(session.updateAge).toBe(60 * 60 * 24);
  });
});
