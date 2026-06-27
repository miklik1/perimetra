import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../common/config/env.js";
import { AuditModule } from "../audit/audit.module.js";
import { CustomersPrivacyHandler } from "../customers/customers.privacy.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { LegalProfilesPrivacyHandler } from "../legal-profiles/legal-profiles.privacy.js";
import { ProjectsPrivacyHandler } from "../projects/projects.privacy.js";
import { ReleaseDraftsPrivacyHandler } from "../release-drafts/release-drafts.privacy.js";
import { StorageModule } from "../storage/storage.module.js";
import { PrivacyProcessor } from "./privacy.processor.js";
import { PRIVACY_HANDLERS, PURGE_HOOKS, type PurgeHook } from "./privacy.tokens.js";
import { PosthogPurgeHook } from "./purge/posthog.purge.js";
import { SentryPurgeHook } from "./purge/sentry.purge.js";

/**
 * Worker-deployable half of privacy (spec §7.7, ADR 0040): the privacy-queue
 * processor (export/erasure fan-out + the daily audit retention sweep, which
 * self-schedules on bootstrap). Imported by `WorkerModule` ONLY.
 *
 * `PRIVACY_HANDLERS` aggregation lives HERE (the `DOMAIN_EVENT_HANDLERS`
 * pattern: the processor's module owns the one array; `pnpm gen module`
 * appends new domain handlers to it).
 */
@Module({
  imports: [JobsModule, StorageModule, AuditModule],
  providers: [
    PrivacyProcessor,
    ProjectsPrivacyHandler,
    ReleaseDraftsPrivacyHandler,
    CustomersPrivacyHandler,
    LegalProfilesPrivacyHandler,
    // @gen:privacy-handlers — `pnpm gen module` appends new handlers here.
    {
      provide: PRIVACY_HANDLERS,
      useFactory: (...handlers: unknown[]) => handlers,
      inject: [
        ProjectsPrivacyHandler,
        ReleaseDraftsPrivacyHandler,
        CustomersPrivacyHandler,
        LegalProfilesPrivacyHandler,
      ],
    },
    // Real third-party purgers (ADR 0036/0040); each no-ops with a log when
    // its env keys are absent.
    {
      provide: PURGE_HOOKS,
      useFactory: (env: Env): PurgeHook[] => [new SentryPurgeHook(), new PosthogPurgeHook(env)],
      inject: [ENV],
    },
  ],
})
export class PrivacyWorkerModule {}
