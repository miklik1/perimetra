/**
 * Better Auth instance factory (ADR 0033). Explicit deps — no module-global
 * `auth` singleton — so the Nest container owns the DB pool, the Redis client
 * and the (stub) mailer, and tests can build instances against fakes.
 *
 * Version policy: better-auth is pinned EXACT (CVE-2025-61928 history); the
 * api-key plugin stays OFF until a project needs it.
 */
import { betterAuth, type SecondaryStorage } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import type { Redis } from "ioredis";

import { type Db } from "@repo/db";
import * as authSchema from "@repo/db/schema/auth";

import { type Env } from "../../common/config/env.js";
import { ac, orgAccessRoles } from "./org-access.js";

export interface CreateAuthDeps {
  db: Db;
  redis: Redis;
  env: Env;
  /** Locale-aware delivery via the email module (spec §7.4). */
  email: {
    sendVerificationEmail(input: {
      to: string;
      name: string;
      verifyUrl: string;
      locale?: string | null;
    }): Promise<void>;
    /** Org-invitation delivery (ADR 0057) — Better Auth's `sendInvitationEmail` hook. */
    sendInvitationEmail(input: {
      to: string;
      inviterName: string;
      orgName: string;
      acceptUrl: string;
      locale?: string | null;
    }): Promise<void>;
  };
  /** Password-reset delivery stays a log stub — no template shipped; projects own the flow. */
  logger: { log(message: string): void };
}

const REDIS_KEY_PREFIX = "better-auth:";

/**
 * Deterministic, unique org slug for the auto-provisioned workspace (ADR 0055):
 * a name-derived prefix plus the user id (already globally unique) as suffix, so
 * the `organization.slug` UNIQUE constraint can never collide across users.
 */
function autoOrgSlug(name: string, userId: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workspace";
  return `${base}-${userId.slice(0, 8)}`;
}

/** Better Auth's SecondaryStorage over the shared ioredis client (TTLs in seconds). */
function redisSecondaryStorage(redis: Redis): SecondaryStorage {
  return {
    get: (key) => redis.get(REDIS_KEY_PREFIX + key),
    // atomic consume for single-use credentials (GETDEL needs Redis >= 6.2; compose runs 7)
    getAndDelete: (key) => redis.getdel(REDIS_KEY_PREFIX + key),
    set: async (key, value, ttl) => {
      if (ttl) await redis.set(REDIS_KEY_PREFIX + key, value, "EX", ttl);
      else await redis.set(REDIS_KEY_PREFIX + key, value);
    },
    delete: async (key) => {
      await redis.del(REDIS_KEY_PREFIX + key);
    },
  };
}

export function createAuth({ db, redis, env, email, logger }: CreateAuthDeps) {
  const isProd = env.NODE_ENV === "production";

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    /** Origin/CSRF check allowlist — the web app reaches us through its same-origin proxy. */
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { ...authSchema },
    }),
    secondaryStorage: redisSecondaryStorage(redis),
    user: {
      additionalFields: {
        /**
         * BCP 47 preference for locale-aware transactional email (spec §7.4).
         * Client-settable at signup/update (`input: true`); column lives on
         * the `user` table in `@repo/db/schema/auth`.
         */
        locale: {
          type: "string",
          required: false,
          input: true,
        },
      },
    },
    /**
     * Org-scope activation (ADR 0055). ONE self-healing hook turns the dormant
     * ADR 0041 tenancy seam live without any switcher UI:
     *
     * `session.create.before` stamps every session's `activeOrganizationId`
     * from the user's owner membership — provisioning the organization + member
     * lazily on the FIRST session (signup) if none exists yet, and just reading
     * it on subsequent logins. So the request scope always resolves to the org
     * (the repositories filter on `organizationId` now); no `setActive` call,
     * no client round-trip.
     *
     * Why here and not `user.create.after`: Better Auth's signup runs
     * `session.create.before` BEFORE `user.create.after`, so the membership
     * wouldn't exist yet when the session is stamped. The user row IS already
     * inserted by this point (its id scopes the session), so provisioning here
     * satisfies the member→user FK. Self-serve org creation stays OFF
     * (`allowUserToCreateOrganization` below) — this is the only provisioning path.
     */
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            if (!ctx) return; // no endpoint context (e.g. direct adapter create) — skip
            const adapter = ctx.context.adapter;
            // Active-org default is DETERMINISTIC (ADR 0057): prefer the user's
            // OWN org (their `owner` membership) so a multi-org user — anyone who
            // has accepted an invite into a second org — always lands in their
            // home org on login rather than an arbitrary `findOne`. An explicit
            // `setActive` (the switcher) overrides it for the rest of the session.
            let membership = await adapter.findOne<{ organizationId: string }>({
              model: "member",
              where: [
                { field: "userId", value: session.userId },
                { field: "role", value: "owner" },
              ],
            });
            // Fall back to ANY membership (covers a future invite-only user with
            // no owner org), then to fresh provisioning below.
            membership ??= await adapter.findOne<{ organizationId: string }>({
              model: "member",
              where: [{ field: "userId", value: session.userId }],
            });
            if (!membership) {
              // First session for this user — auto-provision one org + owner
              // membership (Perimetra tenant = one fabricator company).
              const user = await adapter.findOne<{ name: string }>({
                model: "user",
                where: [{ field: "id", value: session.userId }],
              });
              const org = await adapter.create<{ id: string }>({
                model: "organization",
                data: {
                  name: `${user?.name ?? "Workspace"}'s workspace`,
                  slug: autoOrgSlug(user?.name ?? "workspace", session.userId),
                },
              });
              await adapter.create({
                model: "member",
                data: { organizationId: org.id, userId: session.userId, role: "owner" },
              });
              membership = { organizationId: org.id };
            }
            return { data: { activeOrganizationId: membership.organizationId } };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Off by default — sign-in stays allowed unverified (the verification
      // mail still goes out on signup, see emailVerification below); a
      // project that wants the hard gate flips this one flag.
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        logger.log(`[email stub] password reset for ${user.email}: ${url}`);
      },
    },
    emailVerification: {
      // Verification mail goes out with the signup (delivery is real now —
      // Mailpit locally); sign-in stays allowed unverified until a project
      // flips `requireEmailVerification`.
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        // `locale` is the additionalField registered under `user` above. The
        // hook's `user` parameter is typed as the BASE model (Better Auth's
        // inference doesn't thread additionalFields into callback params), so
        // the cast bridges the known gap — the field IS on the row.
        const { locale } = user as { locale?: string | null };
        await email.sendVerificationEmail({
          to: user.email,
          name: user.name,
          verifyUrl: url,
          locale: locale ?? null,
        });
      },
    },
    session: {
      // Signed cookie cache: getSession() skips the DB/Redis round-trip for
      // 5 minutes; revocations propagate within maxAge.
      cookieCache: { enabled: true, maxAge: 300 },
    },
    advanced: {
      // Explicit `false` is load-bearing: it suppresses the automatic
      // "__Secure-" prefix that would mangle the "__Host-" renames below
      // into "__Secure-__Host-…" in production.
      useSecureCookies: false,
      defaultCookieAttributes: {
        secure: isProd,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
      // __Host- prefix (ADR 0033 hardening): Secure + Path=/ + no Domain,
      // enforced by the browser. Dev keeps default names (http, no Secure).
      ...(isProd
        ? {
            cookies: {
              session_token: { name: "__Host-auth_session_token" },
              session_data: { name: "__Host-auth_session_data" },
              account_data: { name: "__Host-auth_account_data" },
              dont_remember: { name: "__Host-auth_dont_remember" },
            },
          }
        : {}),
    },
    plugins: [
      // Minimal admin surface: ban/unban + impersonation ("log in as the user").
      admin(),
      // Tenancy scope ACTIVE (ADR 0055): every user is auto-provisioned one org
      // (databaseHooks above); self-serve creation stays off (provisioning is the
      // only org-create path). Member sharing is via INVITE (ADR 0057): the
      // custom `ac`/roles (`@repo/auth/permissions`) gate the invite + member-
      // management lifecycle — owner/admin can invite, sales/workshop cannot —
      // and `sendInvitationEmail` routes through the email module (locale-aware).
      organization({
        allowUserToCreateOrganization: false,
        ac,
        roles: orgAccessRoles,
        invitationExpiresIn: 60 * 60 * 48, // 48h
        sendInvitationEmail: async (data) => {
          await email.sendInvitationEmail({
            to: data.email,
            inviterName: data.inviter.user.name,
            orgName: data.organization.name,
            acceptUrl: `${env.WEB_ORIGIN}/accept-invitation/${data.id}`,
            locale: (data.inviter.user as { locale?: string | null }).locale ?? null,
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
