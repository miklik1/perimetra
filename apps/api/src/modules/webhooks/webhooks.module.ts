import { Module } from "@nestjs/common";

import { WebhookDispatcher } from "./webhook-dispatcher.service.js";

/**
 * Outbound-webhook seam (spec §7.6, ADR 0034): the dispatcher only —
 * endpoint registry/config is project-owned (see README.md). Nothing imports
 * this module yet BY DESIGN; a project that binds endpoints imports it into
 * its WORKER module (delivery happens in the events processor, never in the
 * HTTP deployable — ADR 0031) and hangs `createWebhookRelayHandler(...)` off
 * `OutboxWorkerModule`'s `DOMAIN_EVENT_HANDLERS` aggregation.
 */
@Module({
  providers: [WebhookDispatcher],
  exports: [WebhookDispatcher],
})
export class WebhooksModule {}
