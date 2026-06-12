/**
 * HTTP entrypoint. The other deployables from the same image:
 * `worker.js` (queue consumer) and `migrate.js` (one-shot release phase).
 */
import "reflect-metadata";

import helmet from "@fastify/helmet";
import { VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";
import { ENV, loadEnv, type Env } from "./common/config/env.js";
import { registerAuthRateLimit } from "./common/throttle/throttle.module.js";
import { registerOpenApiRoute } from "./openapi/document.js";
import { initSentry } from "./sentry/init.js";

initSentry();

async function bootstrap(): Promise<void> {
  // Env is parsed inside the DI container too; this early parse only sizes
  // the Fastify adapter (which must exist before the app does).
  const bootEnv = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: bootEnv.TRUST_PROXY,
      bodyLimit: bootEnv.BODY_LIMIT_BYTES,
    }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  await app.register(helmet);
  // BEFORE init: the auth route registers during module init and carries the
  // per-route rateLimit config this plugin activates (ADR 0044).
  await registerAuthRateLimit(app.getHttpAdapter().getInstance(), bootEnv);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.enableShutdownHooks();

  const env = app.get<Env>(ENV);
  // GET /openapi.json (ADR 0039) — non-production only; no-op in prod.
  registerOpenApiRoute(app, env);
  await app.listen({ port: env.PORT, host: env.HOST });
}

void bootstrap();
