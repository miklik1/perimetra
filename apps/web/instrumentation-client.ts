import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";

import { env } from "@repo/config/env/web";
import { createPosthogAnalytics } from "@repo/telemetry";
import { buildSentryOptions } from "@repo/telemetry/web";

import { bootFlags } from "./lib/flags-boot";
import { bootTelemetry } from "./lib/telemetry-boot";

// Browser-side Sentry init + telemetry/flags boot (ADR 0021/0028): Next loads
// this file before the app hydrates — the browser is its own JS runtime, so it
// boots the globalThis carriers independently of the server's `register()`.
// Same gate + options as the server init in `instrumentation.ts` — no DSN ⇒ no
// init, and the PII scrubber is pre-wired by `buildSentryOptions`.
if (env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init(
    buildSentryOptions({
      dsn: env.NEXT_PUBLIC_SENTRY_DSN,
      environment: env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      tracesSampleRate: env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      // Next inlines NODE_ENV into client bundles; same dev-only-with-DSN
      // debug gate as the server init.
      debug: process.env.NODE_ENV === "development",
    }),
  );
}
// ONE PostHog client, two seams (ADR 0028): the same posthog-js singleton
// backs telemetry's analytics adapter AND the flags adapter. Both are safe
// pre-init (capture is opted out / flags serve defaults); `posthog.init`
// itself runs in FlagsProvider, which receives this request's server-
// evaluated bootstrap.
bootTelemetry(env.NEXT_PUBLIC_POSTHOG_KEY ? createPosthogAnalytics(posthog) : undefined);
bootFlags();

/** Ties client-side navigations into Sentry's pageload/navigation tracing. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
