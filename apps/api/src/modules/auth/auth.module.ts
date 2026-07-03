/**
 * Auth module (ADR 0033): provides the shared ioredis client and the Better
 * Auth instance, and mounts the Better Auth handler DIRECTLY on the Fastify
 * instance (`/api/auth/*`) — outside Nest's router, so Nest guards,
 * interceptors and versioning never touch it (the community NestJS lib's
 * Fastify support is beta; the manual mount is policy, design §2).
 *
 * Fastify routes by exact path, so `/api/auth/*` cannot collide with the
 * versioned `/v1/*` routes regardless of registration order; the route is
 * added in `onModuleInit`, before `listen()` seals the route table.
 */
import {
  Inject,
  Logger,
  Module,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";

import { type Db } from "@repo/db";

import { ENV, type Env } from "../../common/config/env.js";
import { DB } from "../../common/db/db.module.js";
import { authRateLimitConfig } from "../../common/throttle/throttle.module.js";
import { AuditService } from "../audit/audit.service.js";
import { EmailModule } from "../email/email.module.js";
import { EmailService } from "../email/email.service.js";
import { createAuth, type Auth } from "./auth.instance.js";
import { AUTH, REDIS } from "./auth.tokens.js";
import { MeController } from "./me.controller.js";
import { MembershipService } from "./membership.service.js";
import { OrgProvisioningHook } from "./org-provisioning-hook.js";
import { OrganizationsService } from "./organizations.service.js";
import { PlatformGuard } from "./platform.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  imports: [EmailModule],
  controllers: [MeController],
  providers: [
    {
      provide: REDIS,
      // lazyConnect: boot (and DB-less tests) must not block on Redis — the
      // connection opens on the first auth request. Bounded retries so a down
      // Redis fails requests loudly instead of hanging them.
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }),
      inject: [ENV],
    },
    OrgProvisioningHook,
    {
      provide: AUTH,
      // `onOrgProvisioned` bridges to default-assignment provisioning (ADR 0063)
      // via the AuthModule-owned hook registry — kept here so AuthModule stays a
      // cycle-free leaf (it must never import ReleasesModule). The closure is a
      // no-op until OrgProvisioningModule registers a handler (HTTP app only).
      useFactory: (
        db: Db,
        redis: Redis,
        env: Env,
        email: EmailService,
        provisioning: OrgProvisioningHook,
        audit: AuditService,
        membership: MembershipService,
      ) =>
        createAuth({
          db,
          redis,
          env,
          email,
          logger: new Logger("AuthEmailStub"),
          onOrgProvisioned: (organizationId, ownerUserId) =>
            provisioning.run(organizationId, ownerUserId),
          // Audit the admin() plugin's sensitive mutations (they bypass Nest's
          // guards/AuditService otherwise) — ADR 0040, the platform-admin trail.
          recordAdminAudit: (entry) => audit.record(entry),
          // Close the admin() plugin's MFA bypass (CAR-19 / ADR 0070 amendment):
          // reuses `MembershipService.loadPlatformAccess` — the SAME fresh-DB
          // read `PlatformGuard` uses — so there is one source of truth for "is
          // this user the MFA-enrolled platform operator". `MembershipService`
          // is already a sibling provider in this module (no cycle: it depends
          // only on `TransactionHost`, never on `AUTH`).
          loadPlatformAccess: (userId) => membership.loadPlatformAccess(userId),
        }),
      inject: [DB, REDIS, ENV, EmailService, OrgProvisioningHook, AuditService, MembershipService],
    },
    SessionGuard,
    MembershipService,
    RolesGuard,
    PlatformGuard,
    OrganizationsService,
  ],
  exports: [
    AUTH,
    REDIS,
    SessionGuard,
    MembershipService,
    RolesGuard,
    PlatformGuard,
    OrganizationsService,
    OrgProvisioningHook,
  ],
})
export class AuthModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    // Absent in non-HTTP contexts (worker/CLI app contexts import no adapter).
    const fastify = this.adapterHost?.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify) return;

    const { auth } = this;

    fastify.route({
      method: ["GET", "POST"], // Better Auth only uses GET and POST
      url: "/api/auth/*",
      // Strict per-IP tier (ADR 0044) — active when main.ts registered
      // @fastify/rate-limit; inert config otherwise (tests, worker).
      config: authRateLimitConfig(this.env),
      async handler(request, reply) {
        try {
          // Fastify already parsed application/json into request.body —
          // re-serialize for the Fetch Request (GET has no body).
          const url = new URL(request.url, `http://${request.headers.host}`);
          const response = await auth.handler(
            new Request(url, {
              method: request.method,
              headers: fromNodeHeaders(request.headers),
              ...(request.body ? { body: JSON.stringify(request.body) } : {}),
            }),
          );

          reply.status(response.status);
          response.headers.forEach((value, key) => {
            // set-cookie must not be comma-joined — forward as an array below.
            if (key !== "set-cookie") void reply.header(key, value);
          });
          const setCookies = response.headers.getSetCookie();
          if (setCookies.length > 0) void reply.header("set-cookie", setCookies);

          return await reply.send(response.body ? await response.text() : null);
        } catch (error) {
          request.log.error(error, "better-auth handler failed");
          // Same envelope shape as the global filter (ADR 0014/0030).
          return reply
            .status(500)
            .send({ message: "Internal authentication error", code: "auth_failure" });
        }
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // quit() would wait for a connection that (lazyConnect) may never open.
    if (this.redis.status === "wait" || this.redis.status === "end") {
      this.redis.disconnect();
      return;
    }
    await this.redis.quit();
  }
}
