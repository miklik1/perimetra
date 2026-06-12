import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Typed environment for the Expo/React Native app. Imported from
 * `app.config.ts` and at runtime. MUST NOT be imported into the web bundle —
 * use `@repo/config/env/web` there.
 *
 * Keep this module free of workspace (`@repo/*`) source imports. `app.config.ts`
 * is read by Expo through Node's loader, which cannot resolve our source-only
 * `.ts` packages — pulling in e.g. `@repo/utils` here breaks `expo` config reads
 * on both Node 20 (no type-stripping) and Node 22. Hence `console.error` below
 * instead of `@repo/utils`'s logger: a build-time fatal, not app logging.
 */
export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    EXPO_PUBLIC_API_URL: z.string().url().optional(),
    // TODO(auth-mobile): when the mobile mock lands (ADR 0016 — deferred, no
    // msw/native today), add EXPO_PUBLIC_ENABLE_MSW here mirroring the web env.
    // Sentry (ADR 0021) — declared now, consumed when the dormant mobile app
    // wires `@repo/telemetry/native` (gated with the other mobile work). Both
    // optional: no DSN ⇒ the silent no-op.
    EXPO_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
    // PostHog flags + analytics (ADR 0028) — declared now, consumed when the
    // dormant mobile app wires `@repo/flags/native` (gated with the other
    // mobile work). Both optional: no key ⇒ registry-default flags + no-op
    // analytics, like Sentry above.
    EXPO_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
    EXPO_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
  },
  runtimeEnv: {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
    EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
    console.error("Invalid environment variables", issues);
    throw new Error("Invalid environment variables");
  },
});
