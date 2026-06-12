/**
 * Auth flow over the REAL stack (spec §14): the actual AppModule, the real
 * Better Auth Fastify mount, the Testcontainers Postgres (user/session/
 * account rows) and Redis (secondary storage) — only the HTTP socket is
 * replaced by `fastify.inject`.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cookieFrom, createApiApp, inject, signUpUser, webOrigin } from "./setup/app.js";

describe("auth (real Better Auth + Postgres + Redis)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sign-up issues a session cookie that authenticates /v1/me", async () => {
    const user = await signUpUser(app, "auth-signup");

    const me = await inject(app, {
      method: "GET",
      url: "/v1/me",
      headers: { cookie: user.cookie },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: user.id, email: user.email, name: user.name });
  });

  it("sign-in with the right password works; /v1/me sees the new session", async () => {
    const user = await signUpUser(app, "auth-signin");

    const signIn = await inject(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: webOrigin() },
      payload: { email: user.email, password: user.password },
    });
    expect(signIn.statusCode).toBe(200);

    const cookie = cookieFrom(signIn);
    expect(cookie).not.toBe("");

    const me = await inject(app, { method: "GET", url: "/v1/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: user.id });
  });

  it("rejects a wrong password with 401", async () => {
    const user = await signUpUser(app, "auth-wrong-pw");

    const signIn = await inject(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: webOrigin() },
      payload: { email: user.email, password: "definitely-not-it" },
    });

    expect(signIn.statusCode).toBe(401);
    expect(cookieFrom(signIn)).toBe("");
  });

  it("rejects unauthenticated and garbage-cookie requests with 401", async () => {
    const anonymous = await inject(app, { method: "GET", url: "/v1/me" });
    expect(anonymous.statusCode).toBe(401);

    const forged = await inject(app, {
      method: "GET",
      url: "/v1/me",
      headers: { cookie: "better-auth.session_token=forged-token" },
    });
    expect(forged.statusCode).toBe(401);
  });
});
