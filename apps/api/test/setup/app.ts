/**
 * Shared helpers for the itest files: boot the REAL AppModule the way
 * `main.ts` does (Fastify adapter, URI versioning — minus the listening
 * socket; everything goes through `fastify.inject`), and drive the real
 * Better Auth mount for test users.
 *
 * No mocks anywhere: the app talks to the Testcontainers Postgres/Redis the
 * globalSetup exported via DATABASE_URL/REDIS_URL.
 */
import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { type FastifyInstance, type InjectOptions, type LightMyRequestResponse } from "fastify";

import { type Db } from "@repo/db";
import { member, user as userTable } from "@repo/db/schema/auth";
import { catalogV2, fenceRunV1, slidingGateV1 } from "@repo/fixtures";

import { AppModule } from "../../src/app.module.js";

/**
 * `configure` lets a test override providers before compile (e.g. the ADR 0056
 * margin floor) — the standard Nest testing hook, so itests don't resort to
 * mutating `process.env` between boots.
 */
export async function createApiApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<NestFastifyApplication> {
  const base = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (configure ? configure(base) : base).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function http(app: NestFastifyApplication): FastifyInstance {
  return app.getHttpAdapter().getInstance();
}

export function inject(
  app: NestFastifyApplication,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  return http(app).inject(options);
}

/** Browser origin Better Auth trusts (its CSRF/origin check on POSTs). */
export function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

/** `Cookie` header value from a response's `set-cookie` headers (raw, undecoded). */
export function cookieFrom(response: LightMyRequestResponse): string {
  const setCookie = response.headers["set-cookie"];
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return all
    .map((entry) => entry.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
  /** Session cookie(s) from the sign-up response — pass as the `cookie` header. */
  cookie: string;
}

/**
 * Real sign-up through the Better Auth Fastify mount (`/api/auth/sign-up/
 * email`) — autoSignIn returns the session cookie with the 200. Pass
 * `opts.email` to sign up at a KNOWN address (e.g. to match an invitation sent
 * before the account existed — the invite-first path); otherwise it is random.
 */
export async function signUpUser(
  app: NestFastifyApplication,
  label: string,
  opts: { email?: string } = {},
): Promise<TestUser> {
  const email = opts.email ?? `${label}-${randomUUID()}@itest.example`;
  const password = `pw-${randomUUID()}`;
  const name = `Itest ${label}`;

  const response = await inject(app, {
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: webOrigin() },
    payload: { name, email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`sign-up failed (${response.statusCode}): ${response.body}`);
  }

  const body = response.json() as { user: { id: string } };
  const cookie = cookieFrom(response);
  if (!cookie) throw new Error("sign-up returned no session cookie");

  return { id: body.user.id, email, password, name, cookie };
}

/**
 * Grant the Better Auth admin() role ONLY (`user.role='admin'`), no MFA. For
 * tests that exercise the admin() plugin itself and must RE-SIGN-IN afterwards
 * (e.g. the audit trail test) — a 2FA-enabled user would be bounced to the TOTP
 * challenge on sign-in, so they stay 2FA-free.
 */
export async function grantAdminRole(db: Db, userId: string): Promise<void> {
  await db.update(userTable).set({ role: "admin" }).where(eq(userTable.id, userId));
}

/**
 * Promote a user to a USABLE platform/vendor operator (ADR 0062): the admin role
 * PLUS `twoFactorEnabled` — `PlatformGuard` makes MFA MANDATORY (ADR 0040) and
 * 403s `mfa_required` without it. Setting the flag in the DB stands in for "the
 * operator enrolled TOTP" (the real flow needs a live authenticator code). The
 * platform itests reuse their SIGN-UP session cookie (no re-sign-in), so the
 * existing real session stays valid — only a NEW sign-in would be 2FA-challenged.
 * Both reads are fresh per request, so the promotion takes effect immediately.
 */
export async function promotePlatformAdmin(db: Db, userId: string): Promise<void> {
  await db
    .update(userTable)
    .set({ role: "admin", twoFactorEnabled: true })
    .where(eq(userTable.id, userId));
}

/** A user's (sole) active org id — the auto-provisioned workspace (ADR 0055). */
export async function orgIdOf(db: Db, userId: string): Promise<string> {
  const [row] = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);
  if (!row) throw new Error(`no membership for user ${userId}`);
  return row.orgId;
}

/** Assign published releases to an org over HTTP, as a platform operator (ADR 0062). */
export async function assignReleases(
  app: NestFastifyApplication,
  platformUser: TestUser,
  orgId: string,
  releaseIds: string[],
): Promise<void> {
  for (const releaseId of releaseIds) {
    const res = await inject(app, {
      method: "POST",
      url: `/v1/platform/organizations/${orgId}/releases`,
      headers: { cookie: platformUser.cookie },
      payload: { releaseId },
    });
    if (![200, 201].includes(res.statusCode)) {
      throw new Error(`assign ${releaseId}→${orgId} failed (${res.statusCode}): ${res.body}`);
    }
  }
}

/**
 * Seed the golden corpus (catalog@2 + sliding-gate@1 + fence-run@1) GLOBALLY via
 * a throwaway platform operator, then ASSIGN it to `orgUser`'s org (ADR 0062) so
 * that org can configure/issue. The global publish is idempotent across itest
 * files (tolerates 409 — the stores are shared). Returns nothing; throws on an
 * unexpected status.
 */
export async function seedGoldenCorpusFor(
  app: NestFastifyApplication,
  db: Db,
  orgUser: TestUser,
  opts: { legalProfile?: boolean } = {},
): Promise<void> {
  const platform = await signUpUser(app, "platform-seed");
  await promotePlatformAdmin(db, platform.id);
  const post = (url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: platform.cookie }, payload });

  const cat = await post("/v1/catalog-versions", { body: catalogV2 });
  if (![201, 409].includes(cat.statusCode)) {
    throw new Error(`seed catalog@2 failed (${cat.statusCode}): ${cat.body}`);
  }
  for (const body of [slidingGateV1, fenceRunV1]) {
    const rel = await post("/v1/releases", { catalogVersion: 2, body });
    if (![201, 409].includes(rel.statusCode)) {
      throw new Error(`seed release failed (${rel.statusCode}): ${rel.body}`);
    }
  }
  await assignReleases(app, platform, await orgIdOf(db, orgUser.id), [
    "sliding-gate@1",
    "fence-run@1",
  ]);
  // Every org that gets the corpus can issue — and issuing now requires a legal
  // profile (ADR 0088). Set it as the org owner (admin) so the quote paths work.
  // Opt out (`legalProfile: false`) to exercise the no-profile 422 path.
  if (opts.legalProfile !== false) {
    await setupLegalProfile(app, orgUser);
  }
}

/**
 * A complete §29-ZDPH supplier block (ADR 0088). `issue()` 422s
 * `legal_profile_required` without one, so any org that issues a quote in a test
 * must have its legal profile set (folded into `seedGoldenCorpusFor`; called
 * explicitly where a test sets an issuing org up without that helper). The
 * IČO/DIČ/bank values are checksum-valid so the upsert's zod gate accepts them.
 */
export const TEST_LEGAL_PROFILE = {
  name: "Perimetra Vrata s.r.o.",
  ico: "27074358",
  dic: "CZ27074358",
  vatPayer: true,
  addressLine: "Tovární 5",
  city: "Olomouc",
  postalCode: "779 00",
  country: "CZ",
  bankAccount: "2000145399/2010",
  registrationNote: "Zapsáno v OR vedeném Krajským soudem v Ostravě, oddíl C, vložka 12345.",
} as const;

/** Set the org's singleton legal profile as `orgUser` (its admin/owner). */
export async function setupLegalProfile(
  app: NestFastifyApplication,
  orgUser: TestUser,
): Promise<void> {
  const res = await inject(app, {
    method: "PUT",
    url: "/v1/org/legal-profile",
    headers: { cookie: orgUser.cookie },
    payload: TEST_LEGAL_PROFILE,
  });
  if (res.statusCode !== 200) {
    throw new Error(`seed legal profile failed (${res.statusCode}): ${res.body}`);
  }
}

/** Poll until `predicate` resolves true — for worker-processed effects. */
export async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 30_000, intervalMs = 250, label = "condition" } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} (${timeoutMs}ms)`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
