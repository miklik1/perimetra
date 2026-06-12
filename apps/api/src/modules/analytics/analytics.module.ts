import { Inject, Module, Optional, type OnApplicationShutdown } from "@nestjs/common";
import { PostHog } from "posthog-node";

import { ENV, type Env } from "../../common/config/env.js";
import { AnalyticsService } from "./analytics.service.js";
import { POSTHOG } from "./analytics.tokens.js";

/**
 * PostHog client provider (ADR 0036): null without POSTHOG_API_KEY — the
 * service no-ops. `POSTHOG_PERSONAL_API_KEY` additionally enables LOCAL flag
 * evaluation (each process polls flag definitions independently — keep the
 * default interval; no shared cache exists upstream). EU host by default.
 */
@Module({
  providers: [
    {
      provide: POSTHOG,
      useFactory: (env: Env): PostHog | null =>
        env.POSTHOG_API_KEY
          ? new PostHog(env.POSTHOG_API_KEY, {
              host: env.POSTHOG_HOST,
              ...(env.POSTHOG_PERSONAL_API_KEY
                ? { personalApiKey: env.POSTHOG_PERSONAL_API_KEY }
                : {}),
            })
          : null,
      inject: [ENV],
    },
    AnalyticsService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule implements OnApplicationShutdown {
  constructor(@Optional() @Inject(POSTHOG) private readonly client: PostHog | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client?.shutdown();
  }
}
