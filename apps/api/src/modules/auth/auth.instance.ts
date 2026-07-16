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
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin, organization, twoFactor } from "better-auth/plugins";
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
  /**
   * Invoked once for each genuinely-new org auto-provisioned below (ADR 0063):
   * assigns the vendor-configured default release set so a fresh tenant isn't
   * empty. FAIL-SOFT by contract (never throws — see `OrgProvisioningHook.run`),
   * so it never blocks this session. Wired in the HTTP app only; undefined in
   * worker/seed/CLI contexts → no-op (those never auto-provision).
   */
  onOrgProvisioned?: (organizationId: string, ownerUserId: string) => Promise<void>;
  /**
   * Records a sensitive admin() action (impersonate/ban/role-change/…). The
   * admin plugin's endpoints mount on the raw Fastify handler OUTSIDE Nest's
   * pipeline, so their mutations bypass guards and `AuditService` entirely — a
   * phished platform-admin credential is the most dangerous in the system, so
   * its actions MUST leave an Art. 30 trail. Captured via the Better Auth
   * `after` hook below. Wired in the HTTP app; undefined elsewhere → no-op.
   * Fail-soft by contract (`AuditService.record` never throws).
   */
  recordAdminAudit?: (entry: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
  }) => Promise<void>;
  /**
   * Fresh per-request `{ isOperator, twoFactorEnabled }` read (the SAME query
   * `PlatformGuard` uses via `MembershipService.loadPlatformAccess` — one
   * source of truth), for the `before` hook below. Closes the admin()-plugin
   * MFA bypass (CAR-19 / ADR 0070 amendment): those six mutations mount on the
   * raw Fastify handler OUTSIDE Nest, so `PlatformGuard` never runs there — an
   * operator without enrolled TOTP could still ban/impersonate/set-role. Wired
   * in the HTTP app; undefined elsewhere (worker/seed/CLI) → the hook no-ops
   * (those contexts never receive inbound admin() calls anyway).
   */
  loadPlatformAccess?: (
    userId: string,
  ) => Promise<{ isOperator: boolean; twoFactorEnabled: boolean }>;
}

const REDIS_KEY_PREFIX = "better-auth:";

/**
 * Password-reset stub delivery (no template ships — projects own the real
 * flow). Records only THAT a reset was requested, keyed by the opaque user id;
 * it logs NEITHER the email (PII) NOR the reset url — the url carries the
 * single-use reset token, an account-takeover credential. Redaction is
 * deny-by-omission: a token written to a log sink can't be un-logged. The
 * verification path uses REAL delivery (Mailpit) and likewise logs no PII.
 */
export function logPasswordResetRequest(
  logger: { log(message: string): void },
  user: { id: string },
): void {
  logger.log(`[email stub] password reset requested for user ${user.id}`);
}

/**
 * Public self-serve sign-up policy (ADR 1008): open outside production (dev/test/
 * e2e depend on it), CLOSED in production unless `AUTH_SELF_SIGN_UP` explicitly
 * re-opens it for a provisioning window. When closed, Better Auth's
 * `/api/auth/sign-up/email` route 400s (via `emailAndPassword.disableSignUp`).
 * Sign-in, password reset, email verification and invite-accept are separate
 * routes and stay open — this closes ONLY the anonymous account-minting surface
 * (operator-provisioned + invite-accept remain the account paths). Keyed on
 * `NODE_ENV=production`, the same production signal `assertProductionSecrets` and
 * the `__Host-` cookie switch already trust. Pure — unit-tested in
 * `auth.instance.test.ts`.
 */
export function allowSelfSignUp(env: Pick<Env, "NODE_ENV" | "AUTH_SELF_SIGN_UP">): boolean {
  return env.NODE_ENV !== "production" || env.AUTH_SELF_SIGN_UP;
}

/**
 * admin() plugin endpoints whose mutations must leave an audit trail (ADR 0040),
 * keyed by Better Auth's request-hook `ctx.path` (relative to `basePath`). Each
 * carries the target user in `body.userId`. Read-only admin endpoints (list/get)
 * are deliberately absent.
 */
const ADMIN_AUDIT_ACTIONS: Record<string, string> = {
  "/admin/impersonate-user": "admin.impersonate",
  "/admin/ban-user": "admin.ban",
  "/admin/unban-user": "admin.unban",
  "/admin/remove-user": "admin.remove",
  "/admin/set-role": "admin.set-role",
  "/admin/set-user-password": "admin.set-password",
};

/** Minimum password length (enterprise hardening) — above Better Auth's default 8. */
const MIN_PASSWORD_LENGTH = 12;

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

export function createAuth({
  db,
  redis,
  env,
  email,
  logger,
  onOrgProvisioned,
  recordAdminAudit,
  loadPlatformAccess,
}: CreateAuthDeps) {
  const isProd = env.NODE_ENV === "production";

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    /** Origin/CSRF check allowlist — the web app reaches us through its same-origin proxy. */
    trustedOrigins: [env.WEB_ORIGIN],
    // No `transaction` option → the BA drizzle adapter runs each write
    // auto-committed (default `transaction: false`). LOAD-BEARING for ADR 0063:
    // the org + member rows the session hook creates below must be COMMITTED
    // before `onOrgProvisioned` runs — its default-release `assign` opens a
    // SEPARATE connection (`cls.run`, outside any BA tx), and the
    // `org_release_assignment → organization` FK would fail if the org were
    // still uncommitted. Do NOT enable `transaction: true` without revisiting it.
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
     * it on subsequent logins. UNLESS the user was invited to an org BEFORE they
     * signed up: then provisioning is suppressed so they never carry a throwaway
     * personal org (invite-first onboarding, ADR 0058) — they land in the
     * inviting org once they accept. So the request scope resolves to the org for
     * any provisioned/joined user (the repositories filter on `organizationId`
     * now); no `setActive` call, no client round-trip.
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
              // First session for this user, no membership yet. Fetch the user
              // row (already inserted — its id scopes the session) for the `name`
              // used in provisioning AND the `email` used in the invite-first check.
              const user = await adapter.findOne<{ name: string; email: string }>({
                model: "user",
                where: [{ field: "id", value: session.userId }],
              });
              // Invite-first onboarding (ADR 0058): a user invited to an org
              // BEFORE they signed up must NOT get a throwaway personal org — they
              // belong in the inviting org. When an unexpired `pending` invitation
              // exists for their email, skip provisioning entirely and leave the
              // session org-less: scoped `/v1/*` fail-closed 403 until they accept
              // (the accept page is a Better Auth route, so it works org-less),
              // then `acceptInvitation` stamps the invited org on this session and
              // the `any membership` fallback above re-stamps it on every later
              // login — so no dead workspace, ever. Invitations are keyed by
              // lowercased email from creation (the invitee need not have had an
              // account); Better Auth lowercases both sides, we lowercase too.
              if (user?.email) {
                const pendingInvites = await adapter.findMany<{ expiresAt: Date | string }>({
                  model: "invitation",
                  where: [
                    { field: "email", value: user.email.toLowerCase() },
                    { field: "status", value: "pending" },
                  ],
                });
                const now = Date.now();
                if (pendingInvites.some((inv) => new Date(inv.expiresAt).getTime() > now)) {
                  return; // invite-first: provision nothing; land in the invited org on accept
                }
              }
              // Genuine new owner — auto-provision one org + owner membership
              // (Perimetra tenant = one fabricator company).
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
              // Default provisioning (ADR 0063): assign the vendor-configured
              // default release set so a fresh tenant lands with a populated
              // catalog, not an empty palette. INSIDE the genuine-new-owner
              // branch only — invitees returned at the invite-first early-exit
              // above and are never provisioned a personal org. Fail-soft by the
              // hook's contract, so it never blocks this first session.
              await onOrgProvisioned?.(org.id, session.userId);
            }
            return { data: { activeOrganizationId: membership.organizationId } };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Public self-serve sign-up: CLOSED in production (operator-provisioned
      // only) unless AUTH_SELF_SIGN_UP opens a provisioning window; open outside
      // production. Better Auth 400s /api/auth/sign-up/email when true (ADR 1008).
      // Closing it doesn't strand tenancy: org auto-provisioning runs on
      // session-create (databaseHooks above), so an operator-created user still
      // gets its org on first login.
      disableSignUp: !allowSelfSignUp(env),
      // Policy floor (enterprise hardening): a 12-char minimum, above Better
      // Auth's default 8. Max stays the default (128).
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // Off by default — sign-in stays allowed unverified (the verification
      // mail still goes out on signup, see emailVerification below); a
      // project that wants the hard gate flips this one flag.
      requireEmailVerification: false,
      // `url` (single-use reset token) and `user.email` are deliberately NOT
      // destructured here — they must never reach a log sink. See
      // logPasswordResetRequest.
      sendResetPassword: async ({ user }) => {
        logPasswordResetRequest(logger, user);
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
      // Explicit lifetime policy: 7-day expiry with a 1-day sliding refresh.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Signed cookie cache: getSession() serves the signed payload with NO
      // DB/Redis round-trip for maxAge seconds — so a ban / revoke / erasure
      // only takes effect within this window. Bounded by
      // SESSION_COOKIE_CACHE_MAX_AGE_S (default 60s, was a hardcoded 300s) and
      // treated as the revocation SLA, not a perf knob; 0 disables it (the
      // integration suite sets 0 so a DB-side ban / emailVerified flip is seen
      // at once).
      cookieCache: {
        enabled: env.SESSION_COOKIE_CACHE_MAX_AGE_S > 0,
        maxAge: env.SESSION_COOKIE_CACHE_MAX_AGE_S,
      },
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
    hooks: {
      // The admin() plugin mounts on the raw Fastify handler (outside Nest), so
      // NONE of the six sensitive mutations in ADMIN_AUDIT_ACTIONS ever pass
      // `PlatformGuard` — an operator without enrolled TOTP could ban/impersonate/
      // set-role despite MFA being MANDATORY on every other platform surface
      // (ADR 0070). Close it here (CAR-19): a cheap path-map lookup, then the
      // SAME fresh-DB `{ isOperator, twoFactorEnabled }` read `PlatformGuard`
      // uses. The admin() plugin resolves ITS OWN session only *inside* the
      // endpoint handler — after this hook runs (`dispatchAuthEndpoint` seeds
      // `ctx.context.session` to `null` for a fresh request) — so we resolve it
      // ourselves via Better Auth's own `getSessionFromCtx`, which reads the
      // request's cookies/headers directly off `ctx`. It also CACHES its result
      // on `ctx.context.session`, so the admin() plugin's own subsequent lookup
      // for the same request is free, not a second round-trip.
      before: createAuthMiddleware(async (ctx) => {
        if (!(ctx.path in ADMIN_AUDIT_ACTIONS) || !loadPlatformAccess) return;
        const session = await getSessionFromCtx(ctx);
        const userId = session?.user?.id;
        // No session: unauthenticated — the admin() plugin's own middleware
        // 401s this itself; don't duplicate that check here.
        if (typeof userId !== "string") return;
        const access = await loadPlatformAccess(userId);
        // Not the platform operator: leave the plugin's OWN permission check
        // (`hasPermission`) to decide — unchanged behavior for every other
        // caller, this gate only tightens the operator's own surface.
        if (!access.isOperator) return;
        if (!access.twoFactorEnabled) {
          throw new APIError("FORBIDDEN", {
            message: "Two-factor authentication must be enabled for platform operations",
            code: "mfa_required",
          });
        }
      }),
      // The admin() plugin mounts on the raw Fastify handler (outside Nest), so
      // its sensitive mutations never pass a Nest guard or AuditService. Capture
      // them here — the Art. 30 trail for the most dangerous credential (ADR 0040).
      // Fail-soft: `recordAdminAudit` (→ AuditService.record) never throws.
      after: createAuthMiddleware(async (ctx) => {
        const action = ADMIN_AUDIT_ACTIONS[ctx.path];
        if (!action || !recordAdminAudit) return;
        const body = ctx.body as { userId?: unknown } | undefined;
        if (typeof body?.userId !== "string") return;
        const session = ctx.context.session as { user?: { id?: unknown } } | undefined;
        const actorId = typeof session?.user?.id === "string" ? session.user.id : null;
        await recordAdminAudit({
          actorId,
          action,
          entityType: "user",
          entityId: body.userId,
        });
      }),
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
      // TOTP two-factor (ADR 0040 / §1 gap analysis). Available to every user;
      // MANDATORY for the platform operator (enforced in `PlatformGuard`, which
      // 403s `mfa_required` until `user.twoFactorEnabled` is true). Enrolling sets
      // up a secret + backup codes (returned once) and the user confirms a code —
      // `skipVerificationOnEnable` stays at its default (off), so a fresh code is
      // required to flip the flag. Once enabled, sign-in is 2FA-challenged
      // (the web routes `data.twoFactorRedirect` to `/two-factor`). Default-off
      // column means no existing user is challenged until they opt in / are forced.
      twoFactor({ issuer: "Perimetra" }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
