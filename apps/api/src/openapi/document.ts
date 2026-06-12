/**
 * OpenAPI document (ADR 0039 — the contract half of the zod API semantics).
 *
 * The doc is GENERATED, never hand-written: `SwaggerModule.createDocument`
 * scans the Nest router (URI-versioned routes included), and nestjs-zod v5's
 * `cleanupOpenApiDoc` post-processes the schemas that `createZodDto` classes
 * contribute — so the published contract is derived from the SAME shared zod
 * schemas (`@repo/validators`) the validation pipe and the response-stripping
 * serializer enforce at runtime. Drift between contract and behavior is
 * structurally impossible; drift between contract and the committed snapshot
 * fails CI (see `openapi.snapshot.test.ts`).
 *
 * Not in the doc: the raw Better Auth routes (`/api/auth/*`) — they are
 * registered straight on Fastify, outside Nest's router (auth.module.ts), and
 * their contract belongs to Better Auth, not this service.
 */
import { type INestApplication } from "@nestjs/common";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";

import { type Env } from "../common/config/env.js";

/** Dev session cookie name (Better Auth default; `__Host-` prefixed in prod). */
const SESSION_COOKIE = "better-auth.session_token";

/**
 * Build the OpenAPI document from a created (module-scanned) Nest app.
 * Deterministic for a given codebase — title/version are fixed strings, never
 * read from package.json, so the snapshot only changes when the API does.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("api")
    .setDescription(
      "Versioned HTTP API (URI versioning, default v1). Requests validate and " +
        "responses are stripped against the shared zod contracts in @repo/validators " +
        "(ADR 0039). Errors use the ApiError envelope { message, code?, errors? }. " +
        "Unsafe routes marked idempotent honor the Idempotency-Key header. " +
        "Authentication is the httpOnly Better Auth session cookie; the /api/auth/* " +
        "routes themselves are Better Auth's and are not part of this document.",
    )
    .setVersion("1")
    .addCookieAuth(SESSION_COOKIE)
    .build();

  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

/**
 * Serve `GET /openapi.json` — NON-production only (the contract is a dev/CI
 * artifact; production exposes nothing it doesn't have to, ADR 0044 posture).
 *
 * Registered straight on Fastify (like the Better Auth mount) so it needs no
 * Nest module wiring; call from `main.ts` after `NestFactory.create` and
 * before `app.listen`. The doc is built lazily on first request and cached —
 * boot pays nothing for it.
 */
export function registerOpenApiRoute(app: NestFastifyApplication, env: Env): void {
  if (env.NODE_ENV === "production") return;

  let cached: OpenAPIObject | undefined;
  app
    .getHttpAdapter()
    .getInstance()
    .get("/openapi.json", (_request, reply) => {
      cached ??= buildOpenApiDocument(app);
      return reply.send(cached);
    });
}
