import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// NOTE: when any `NEXT_PUBLIC_*` var is declared below, `apps/web/next.config.js`
// MUST `import "@repo/config/env/web"` so `@t3-oss/env-nextjs` validates them at
// build time. Without that import, validation only runs on the first runtime
// import of this module.

/**
 * Typed environment for the Next.js web app. Imported by RSC/route handlers
 * (and `next.config.js` when build-time validation of `NEXT_PUBLIC_*` vars is
 * needed). MUST NOT be imported into the React Native bundle — use
 * `@repo/config/env/mobile` there.
 */
export const env = createEnv({
  /** Server-only vars (no special prefix). */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Real backend origin behind the BFF (ADR 0018). Server-only: the BFF proxy
    // (`handle-api-request.ts`) reads it in-process/route-handler; the browser
    // only ever sees the same-origin `/api`, so this MUST NOT be NEXT_PUBLIC_
    // (that would inline the backend origin into the client bundle, defeating
    // the origin-hiding the BFF exists for). Absent ⇒ jsonplaceholder demo host.
    // https-only egress outside development: a plaintext http backend origin
    // would relay bearer tokens / session cookies over the wire (see
    // `handle-api-request.ts` credential forwarding). http is allowed only when
    // NODE_ENV === "development" (local stacks); test/production require https.
    // NODE_ENV is read from `process.env` with the SAME default as the schema's
    // own NODE_ENV field (undefined ⇒ "development").
    API_URL: z
      .string()
      .url()
      .optional()
      .refine(
        (url) =>
          url === undefined ||
          (process.env.NODE_ENV ?? "development") === "development" ||
          url.startsWith("https://"),
        { message: "API_URL must use https outside development" },
      ),
    // Sentry source-map upload (ADR 0021) — build/CI only, consumed by
    // `withSentryConfig`. Absent ⇒ upload silently skipped; `next build` never
    // depends on it.
    SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
    // PostHog server-side local flag evaluation (ADR 0028) — optional tuning:
    // present ⇒ posthog-node evaluates flags in-process (no per-request call to
    // PostHog); absent ⇒ a remote /flags call per request. Never client-visible.
    POSTHOG_PERSONAL_API_KEY: z.string().min(1).optional(),
  },

  /** Browser-exposed vars; must be prefixed with NEXT_PUBLIC_. */
  client: {
    // MSW dev mock (ADR 0016). `ENABLE_MSW` gates whether the worker starts at
    // all; `MSW_MOCKS` is a comma-separated list of handler groups to activate
    // (e.g. "auth"). Unlisted groups fall through to the real API (partial
    // mocking via onUnhandledRequest: "bypass"). Both dev-only.
    NEXT_PUBLIC_ENABLE_MSW: z.enum(["true", "false"]).optional(),
    NEXT_PUBLIC_MSW_MOCKS: z.string().optional(),
    // Dev-only: log every API request/response + timing via the injectable debug
    // middleware. Tree-shaken out unless set (ADR 0018 observability).
    NEXT_PUBLIC_DEBUG_API: z.enum(["true", "false"]).optional(),
    // Sentry (ADR 0021) — ALL optional: no DSN ⇒ telemetry stays the silent
    // no-op (dev/test default). NEXT_PUBLIC_-prefixed (not server twins)
    // because `instrumentation-client.ts` only sees inlined client vars, and
    // the server init reads the same values — one var per concern.
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: z.string().min(1).optional(),
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
    // PostHog (ADR 0028) — ALL optional: no key ⇒ flags serve registry defaults
    // and analytics stays the silent no-op (dev/test default). NEXT_PUBLIC_-
    // prefixed for the same reason as the Sentry vars (client init reads them;
    // the server eval reads the same values — one var per concern). The host
    // default (EU cloud, https://eu.i.posthog.com) is applied at the use-site,
    // not here — the schema stays a pure presence/format contract.
    NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
    // Centrifugo websocket endpoint (spec §7.6). NEXT_PUBLIC_ because the
    // browser connects directly (realtime bypasses the BFF by design — only
    // the JWT mint goes through /api). Absent ⇒ local docker default
    // (ws://localhost:8000/connection/websocket) applied at the use-site.
    NEXT_PUBLIC_REALTIME_URL: z.string().url().optional(),
  },

  /** Runtime values destructured from process.env (all server + client vars). */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    API_URL: process.env.API_URL,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    POSTHOG_PERSONAL_API_KEY: process.env.POSTHOG_PERSONAL_API_KEY,
    NEXT_PUBLIC_ENABLE_MSW: process.env.NEXT_PUBLIC_ENABLE_MSW,
    NEXT_PUBLIC_MSW_MOCKS: process.env.NEXT_PUBLIC_MSW_MOCKS,
    NEXT_PUBLIC_DEBUG_API: process.env.NEXT_PUBLIC_DEBUG_API,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
  },

  /** Skip when env vars aren't available (Docker builds, CI type-checks). */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /** Treat empty strings as undefined. */
  emptyStringAsUndefined: true,
});
