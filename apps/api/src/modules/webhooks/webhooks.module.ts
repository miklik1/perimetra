import { Module } from "@nestjs/common";

import { ConfigModule } from "../../common/config/config.module.js";
import { ENV, type Env } from "../../common/config/env.js";
import {
  WEBHOOK_EGRESS_POLICY,
  WebhookDispatcher,
  type WebhookEgressPolicy,
} from "./webhook-dispatcher.service.js";

/**
 * Outbound-webhook seam (spec §7.6, ADR 0034): the dispatcher only —
 * endpoint registry/config is project-owned (see README.md). Nothing imports
 * this module yet BY DESIGN; a project that binds endpoints imports it into
 * its WORKER module (delivery happens in the events processor, never in the
 * HTTP deployable — ADR 0031) and hangs `createWebhookRelayHandler(...)` off
 * `OutboxWorkerModule`'s `DOMAIN_EVENT_HANDLERS` aggregation.
 *
 * This is the ONE place the private-target egress hatch is decided (ADR 1047):
 * a deployment-wide env value, never per-endpoint and never per-delivery.
 */
@Module({
  // `ConfigModule` is @Global, so this import is not what makes ENV resolvable
  // in the running app — it is what makes this module self-contained, so a
  // testing module that imports WebhooksModule alone still resolves the policy
  // rather than silently falling back to the bare-constructor default.
  imports: [ConfigModule],
  providers: [
    {
      provide: WEBHOOK_EGRESS_POLICY,
      inject: [ENV],
      useFactory: (env: Env): WebhookEgressPolicy => ({
        allowPrivateTargets: env.WEBHOOK_EGRESS_ALLOW_PRIVATE,
      }),
    },
    WebhookDispatcher,
  ],
  exports: [WebhookDispatcher],
})
export class WebhooksModule {}
