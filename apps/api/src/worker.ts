/**
 * Worker entrypoint — consumes BullMQ queues and relays the outbox; scales
 * independently of the HTTP api (ADR 0031). Queue processor modules register
 * in worker.module.ts (and ONLY there, ADR 0043); this entrypoint boots the
 * same DI container (config, logger, db, CLS) and shuts down gracefully.
 */
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { initSentry } from "./sentry/init.js";
import { WorkerModule } from "./worker.module.js";

initSentry();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  logger.log("worker up — outbox relay + events/dlq/maintenance queues", "Worker");

  // BullMQ workers + the relay interval own the event loop from here.
  // Shutdown hooks handle SIGTERM/SIGINT (queues drain, relay flushes).
}

void bootstrap();
