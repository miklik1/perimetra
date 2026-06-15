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
import { type FastifyInstance, type InjectOptions, type LightMyRequestResponse } from "fastify";

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
