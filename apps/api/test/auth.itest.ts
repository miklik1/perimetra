/**
 * Auth flow over the REAL stack (spec §14): the actual AppModule, the real
 * Better Auth Fastify mount, the Testcontainers Postgres (user/session/
 * account rows) and Redis (secondary storage) — only the HTTP socket is
 * replaced by `fastify.inject`.
 */
import { randomUUID } from "node:crypto";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { audit } from "@repo/db/schema/audit";

import { DB } from "../src/common/db/db.module.js";
import {
  cookieFrom,
  createApiApp,
  grantAdminRole,
  inject,
  promotePlatformAdmin,
  signUpUser,
  webOrigin,
} from "./setup/app.js";

describe("auth (real Better Auth + Postgres + Redis)", () => {
  let app: NestFastifyApplication;
  let db: Db;

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
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

  it("rejects a sign-up whose password is below the 12-char policy minimum", async () => {
    const res = await inject(app, {
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: webOrigin() },
      payload: { name: "Shorty", email: `short-${randomUUID()}@example.com`, password: "shortpw" },
    });
    // Better Auth rejects the short password with a 4xx (PASSWORD_TOO_SHORT).
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("audits the admin() plugin's sensitive mutations (they bypass Nest guards)", async () => {
    const adminUser = await signUpUser(app, "auth-admin-actor");
    // Role first, no MFA yet: the sign-in below needs a NORMAL (non-2FA-
    // challenged) flow to refresh the session's cached role — a 2FA-enrolled
    // user is challenged on SIGN-IN, not on reusing an already-established
    // session (see `promotePlatformAdmin`'s doc comment).
    await grantAdminRole(db, adminUser.id);
    // Fresh session AFTER the role grant — the signup session predates it, and
    // the signed cookie cache would otherwise serve a stale (non-admin) role to
    // Better Auth's OWN admin-plugin permission check (`hasPermission`).
    const signIn = await inject(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: webOrigin() },
      payload: { email: adminUser.email, password: adminUser.password },
    });
    expect(signIn.statusCode).toBe(200);
    const adminCookie = cookieFrom(signIn);
    // NOW enable MFA (post-sign-in, simulating "already enrolled"): the admin()
    // plugin's mutations are MFA-gated too as of CAR-19 (ADR 0070 amendment, the
    // `before` hook) — the gate re-reads this FRESH from the DB every request,
    // so it takes effect immediately without another sign-in.
    await promotePlatformAdmin(db, adminUser.id);

    const target = await signUpUser(app, "auth-admin-target");

    const ban = await inject(app, {
      method: "POST",
      url: "/api/auth/admin/ban-user",
      headers: { cookie: adminCookie, origin: webOrigin() },
      payload: { userId: target.id },
    });
    expect(ban.statusCode).toBe(200);

    // The mutation left an audit row attributing it to the acting admin — the
    // trail that did NOT exist before (admin endpoints mount outside Nest).
    const rows = await db
      .select()
      .from(audit)
      .where(and(eq(audit.action, "admin.ban"), eq(audit.entityId, target.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: adminUser.id, entityType: "user" });
  });

  it("403 mfa_required: a platform operator without TOTP cannot reach platform routes (ADR 0040)", async () => {
    const operator = await signUpUser(app, "auth-operator-nomfa");
    // Role only — NO twoFactorEnabled (the real lockout state before enrollment).
    await grantAdminRole(db, operator.id);

    const res = await inject(app, {
      method: "GET",
      url: "/v1/platform/organizations",
      headers: { cookie: operator.cookie },
    });

    // The role check passes, the mandatory-MFA check does not — a DISTINCT code
    // so the web can route to enrollment rather than show a dead end.
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("mfa_required");
  });

  it("403 mfa_required: the admin() plugin's OWN mutations are gated too (CAR-19 / ADR 0070 amendment)", async () => {
    const operator = await signUpUser(app, "auth-admin-plugin-nomfa");
    // Role only — NO twoFactorEnabled (the real lockout state before enrollment).
    await grantAdminRole(db, operator.id);
    const target = await signUpUser(app, "auth-admin-plugin-nomfa-target");

    const res = await inject(app, {
      method: "POST",
      url: "/api/auth/admin/set-role",
      headers: { cookie: operator.cookie, origin: webOrigin() },
      payload: { userId: target.id, role: "user" },
    });

    // Blocked by the SAME `before`-hook gate as `/v1/platform/*` — the admin()
    // plugin's endpoints mount OUTSIDE Nest, so `PlatformGuard` never runs
    // there; this is exactly the bypass CAR-19 closes.
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("mfa_required");
  });

  it("the admin() mutation succeeds once the operator's TOTP is enrolled", async () => {
    const operator = await signUpUser(app, "auth-admin-plugin-2fa");
    await grantAdminRole(db, operator.id);
    // Fresh sign-in BEFORE enabling MFA — refreshes the cached session role for
    // Better Auth's OWN admin-permission check (a 2FA-enrolled user would be
    // challenged on sign-in rather than getting a session).
    const signIn = await inject(app, {
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: webOrigin() },
      payload: { email: operator.email, password: operator.password },
    });
    expect(signIn.statusCode).toBe(200);
    const cookie = cookieFrom(signIn);
    // Enrolling a REAL TOTP secret in an itest is heavy (needs a live
    // authenticator code); setting the flag directly simulates "already
    // enrolled" — it's exactly what `loadPlatformAccess` reads.
    await promotePlatformAdmin(db, operator.id);
    const target = await signUpUser(app, "auth-admin-plugin-2fa-target");

    const res = await inject(app, {
      method: "POST",
      url: "/api/auth/admin/set-role",
      headers: { cookie, origin: webOrigin() },
      payload: { userId: target.id, role: "user" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("does not change behavior for a non-admin caller (the plugin's own permission check still applies)", async () => {
    const nonAdmin = await signUpUser(app, "auth-admin-plugin-nonadmin");
    const target = await signUpUser(app, "auth-admin-plugin-nonadmin-target");

    const res = await inject(app, {
      method: "POST",
      url: "/api/auth/admin/set-role",
      headers: { cookie: nonAdmin.cookie, origin: webOrigin() },
      payload: { userId: target.id, role: "user" },
    });

    // The gate no-ops for a non-operator (falls through to the plugin's own
    // permission check) — the SAME 403 the admin() plugin has always returned
    // for this caller, NOT `mfa_required`.
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE");
  });
});
