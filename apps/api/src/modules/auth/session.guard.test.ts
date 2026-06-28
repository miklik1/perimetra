/**
 * Guard behavior through a real (DB-less) Nest+Fastify app: the AUTH provider
 * is a stub, so this only exercises guard → filter → envelope wiring.
 */
import { VersioningType } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlobalExceptionFilter } from "../../common/filters/global-exception.filter.js";
import { type Auth } from "./auth.instance.js";
import { AUTH } from "./auth.tokens.js";
import { MeController } from "./me.controller.js";
import { MembershipService } from "./membership.service.js";
import { RolesGuard } from "./roles.guard.js";
import { SessionGuard } from "./session.guard.js";

const getSession = vi.fn();

async function bootApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [MeController],
    providers: [
      SessionGuard,
      // /me now runs RolesGuard too (ADR 0056); stub the membership reads so this
      // DB-less wiring test still only exercises guard → filter → envelope.
      // `isPlatformAdmin` (ADR 0062) is resolved fresh from the DB — stub false.
      RolesGuard,
      {
        provide: MembershipService,
        useValue: { resolveRole: async () => "admin", isPlatformOperator: async () => false },
      },
      { provide: AUTH, useValue: { api: { getSession } } as unknown as Auth },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("SessionGuard", () => {
  let app: NestFastifyApplication;

  afterEach(async () => {
    await app.close();
    getSession.mockReset();
  });

  it("rejects sessionless requests with a 401 ApiError envelope", async () => {
    getSession.mockResolvedValue(null);
    app = await bootApp();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { message: string };
    expect(typeof body.message).toBe("string");
  });

  it("passes the session user through to @CurrentSession() consumers", async () => {
    const user = { id: "u_1", email: "ada@example.com", name: "Ada" };
    getSession.mockResolvedValue({
      session: { id: "s_1", userId: "u_1", activeOrganizationId: "org_1" },
      user,
    });
    app = await bootApp();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject(user);
  });

  it("field-picks /v1/me so admin()/twoFactor plugin fields never leak over the wire", async () => {
    // session.user carries the admin() + twoFactor plugin fields (banned/
    // banReason/banExpires/twoFactorEnabled) + a plugin `role`; the controller
    // must ship ONLY the client-safe contract {id,email,name,createdAt} plus the
    // freshly-resolved org `role` + `isPlatformAdmin`.
    getSession.mockResolvedValue({
      session: { id: "s_1", userId: "u_1", activeOrganizationId: "org_1" },
      user: {
        id: "u_1",
        email: "ada@example.com",
        name: "Ada",
        createdAt: "2026-01-01T00:00:00.000Z",
        role: "owner",
        banned: true,
        banReason: "spam",
        banExpires: "2026-12-31T00:00:00.000Z",
        twoFactorEnabled: true,
        image: "https://example.com/a.png",
      },
    });
    app = await bootApp();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id: "u_1",
      email: "ada@example.com",
      name: "Ada",
      createdAt: "2026-01-01T00:00:00.000Z",
      // the org role is the MembershipService-resolved value, NOT the leaked
      // admin-plugin `role: "owner"`; isPlatformAdmin is resolved fresh.
      role: "admin",
      isPlatformAdmin: false,
    });
    expect(body).not.toHaveProperty("banned");
    expect(body).not.toHaveProperty("banReason");
    expect(body).not.toHaveProperty("banExpires");
    expect(body).not.toHaveProperty("twoFactorEnabled");
    expect(body).not.toHaveProperty("image");
  });
});
