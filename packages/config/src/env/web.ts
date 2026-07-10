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

/**
 * Deployment tier — the single signal the app reads to decide whether it serves
 * full mocks (preview), a mixed stage, or the live backend (prod). DERIVED,
 * never hand-set, so tier and environment stay structurally inseparable (nobody
 * can scope prod behaviour onto a preview URL).
 *
 * Precedence:
 *  1. `VERCEL_TARGET_ENV` (Vercel system var, present at BOTH build and runtime)
 *     wins whenever set — on Vercel the tier is never hand-overridable.
 *     "production" → "prod", "stage" → "stage", everything else ("preview",
 *     "development", or a custom env name) → "preview" (fail-safe: an unknown
 *     environment is never live).
 *  2. else `APP_TIER` — the manual override for the NON-Vercel deploy path (this
 *     skeleton's platform-agnostic container/standalone image,
 *     `docs/operations/deploy.md`, never sets VERCEL_TARGET_ENV).
 *  3. else "preview" — the safe default: mocks stay possible until `API_URL` is
 *     configured (preserves the tri-state mock fallback below).
 *
 * Why not `NODE_ENV`: Vercel builds BOTH preview and prod with
 * `NODE_ENV=production`, so any mock/data-source gate keyed on
 * `NODE_ENV !== "production"` breaks across tiers (kills mocks on preview or
 * leaks them to prod). Why not `VERCEL_ENV`: it collapses a Custom Environment
 * ("stage") to "preview". See the vault finding "Multi-tier Vercel (Next)
 * deploy — derive the tier from VERCEL_TARGET_ENV, not NODE_ENV; gate at build
 * AND runtime" (Primat ADR 0047 is the richer downstream reference — that is
 * Primat Plus's own numbering, unrelated to perimetra's). The decision lives in
 * perimetra's ADR 0104 (drained from skeleton ADR 0046 and renumbered).
 *
 * This is a two-arg EXTENSION of Primat's single-arg `resolveTier`: the second
 * `appTierOverride` arg exists ONLY because this skeleton has a non-Vercel
 * deploy path — Primat is Vercel-only and never needed it.
 */
export function resolveTier(
  vercelTargetEnv: string | undefined,
  appTierOverride: "preview" | "stage" | "prod" | undefined,
): "preview" | "stage" | "prod" {
  // Normalise (trim + lower-case): a non-canonical VERCEL_TARGET_ENV value (odd
  // casing / stray whitespace from a hand-set or overridden var) must NOT fall
  // through to the "preview" catch-all on a real Production target — that is the
  // mock-leak-to-prod direction. Vercel's own env slugs are already lower-case,
  // so this only hardens against a misconfigured override. `appTierOverride` is
  // normalised by its caller (`readAppTier` below) for the same reason — the
  // schema enum alone is NOT enough, because SKIP_ENV_VALIDATION disables it on
  // the one path where APP_TIER is the sole tier signal.
  const target = vercelTargetEnv?.trim().toLowerCase();
  if (target) {
    if (target === "production") return "prod";
    if (target === "stage") return "stage";
    return "preview";
  }
  return appTierOverride ?? "preview";
}

export const env = createEnv({
  /** Server-only vars (no special prefix). */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Vercel's deployment-environment system var ("production" / "preview" /
    // "development" / a Custom Environment name like "stage"), present at BOTH
    // build and runtime. RAW passthrough — Vercel sets it, NEVER hand it in.
    // The tier (`TIER` below) DERIVES from it via `resolveTier`; declared here
    // so it is validated + typed, but the derivation reads it RAW from
    // process.env so tier resolution matches the build-time guard even under
    // SKIP_ENV_VALIDATION.
    VERCEL_TARGET_ENV: z.string().optional(),
    // Manual tier override for the NON-Vercel deploy path — the platform-agnostic
    // container/standalone image (`docs/operations/deploy.md`) which never sets
    // VERCEL_TARGET_ENV. IGNORED whenever VERCEL_TARGET_ENV is present (Vercel
    // owns the tier there). Unset ⇒ "preview" (safe default).
    APP_TIER: z.enum(["preview", "stage", "prod"]).optional(),
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
    VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV,
    APP_TIER: process.env.APP_TIER,
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

/**
 * The resolved deployment tier (see `resolveTier`). Read this EVERYWHERE a
 * mock/data-source decision is made — the BFF mock gate
 * (`apps/web/lib/route-handler/handle-api-request.ts`), the home-page RSC
 * prefetch gate (`apps/web/app/page.tsx`), the next.config rewrites gate, and
 * the build-time `assertTierInvariants`. NEVER re-derive a tier from `NODE_ENV`.
 *
 * BOTH inputs are read RAW from `process.env`, never through the `env` proxy:
 *
 *  - it resolves even under `SKIP_ENV_VALIDATION`, matching the raw check in
 *    `assert-tier-invariants.ts`; and
 *  - `APP_TIER` is a SERVER var, so reading it through the `env` proxy at MODULE
 *    scope makes `@t3-oss/env` throw "Attempted to access a server-side
 *    environment variable on the client" for ANY importer evaluated in a client
 *    context (a jsdom component test, or a genuine client component) — merely
 *    importing this module is enough; nothing has to read `TIER`. Reading raw is
 *    inert there: neither var is `NEXT_PUBLIC_`-inlined, so a browser bundle sees
 *    `undefined` and TIER falls to "preview" — which no client code reads (every
 *    TIER consumer is server-side).
 *
 * `APP_TIER` stays declared in the schema above, so an invalid value still fails
 * `createEnv` on the server — the same arrangement `VERCEL_TARGET_ENV` already
 * had. Empty string ⇒ undefined ⇒ the "preview" default.
 *
 * NORMALISE (trim + lower-case) exactly as `resolveTier` does for
 * `VERCEL_TARGET_ENV`. The schema enum is NOT sufficient: on the non-Vercel
 * container/standalone prod build — the one path where `APP_TIER` is the sole
 * tier signal — `SKIP_ENV_VALIDATION` is the documented escape hatch, and it
 * makes `createEnv` skip the enum check entirely. Without lower-casing, a typo'd
 * `APP_TIER="PROD"` would narrow to `undefined`, resolve `TIER="preview"`, sail
 * past the SKIP-on-prod refusal in `assertTierInvariants` (which keys on
 * `TIER === "prod"`), and serve MOCKS on a deploy the operator intended as prod
 * — the exact mock-leak-to-prod bug the tier mechanism exists to close.
 */
function readAppTier(): "preview" | "stage" | "prod" | undefined {
  const raw = process.env.APP_TIER?.trim().toLowerCase();
  return raw === "preview" || raw === "stage" || raw === "prod" ? raw : undefined;
}

export const TIER = resolveTier(process.env.VERCEL_TARGET_ENV, readAppTier());
