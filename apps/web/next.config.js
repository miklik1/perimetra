// Imported at config time: runs `@t3-oss/env-nextjs` createEnv at build time so
// any missing/invalid NEXT_PUBLIC_* var fails the build instead of the first
// request. See `packages/config/src/env/web.ts`.
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

import { assertTierInvariants } from "@repo/config/env/assert-tier-invariants";
import { env, TIER } from "@repo/config/env/web";

// Build-time tier-invariant guard — the build-time half of "gate at build AND
// runtime" (vault finding "Multi-tier Vercel (Next) deploy …" lesson 5). Runs
// at config-load so a tier/env contradiction (e.g. a preview env scope copied
// onto the Production environment, or a prod deploy missing its backend origin)
// FAILS `next build` before any chunk is emitted. Imported by package specifier
// (not a relative `.ts`) so it resolves under next.config's Node ESM loader
// (finding lesson 2).
assertTierInvariants();

// next-intl plugin (ADR 0020): wires the per-request config so RSC renders in the
// cookie-selected locale. "Without i18n routing" — no `[locale]` segment, no
// middleware; the locale comes from the cookie inside `./i18n/request.ts`.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Static security headers (ADR 0026) applied to every routed response. The
// per-request nonce-based Content-Security-Policy is NOT here — a static
// `headers()` value can't carry a fresh per-request nonce — it is set in
// `proxy.ts` (middleware). These are the request-independent half: transport,
// sniffing, framing, and feature-policy hardening for a standalone deploy. NOTE:
// `proxy.ts` keeps a copy (`STATIC_SECURITY_HEADERS`) to re-apply on its auth
// redirect, which bypasses this `headers()` hook — keep the two in sync.
// Auth/API rewrite proxy (design §9): `/api/auth/*` (Better Auth) and
// `/api/v1/*` (versioned API) go straight to the API service so the httpOnly
// session cookie stays first-party (same-origin, no CORS). Server-only target —
// the browser never sees the backend origin. `API_URL` doubles as the BFF
// proxy target (lib/route-handler/handle-api-request.ts); unset, the local
// API service default applies.
const apiProxyTarget = env.API_URL ?? "http://localhost:4000";

// Mirror of the BFF mock gate in lib/route-handler/handle-api-request.ts
// (tri-state: explicit "true"/"false" wins; unset defaults to mocks ON only
// while no real backend is configured; never on the prod tier). Must stay in
// lockstep so the rewrites and the route handler agree on who serves /api/* —
// including the `TIER !== "prod"` conjunct (NOT `NODE_ENV`): a NODE_ENV gate
// here would let the /api/auth/* + /api/v1/* rewrites bypass the (tier-gated)
// mock route on a Vercel preview and silently defeat the fix (finding lesson 1).
const mocksEnabled =
  TIER !== "prod" &&
  (env.NEXT_PUBLIC_ENABLE_MSW === "true" ||
    (env.NEXT_PUBLIC_ENABLE_MSW === undefined && env.API_URL === undefined));

const securityHeaders = [
  // 2 years, include subdomains, eligible for the browser preload list.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Standalone (not iframed) — deny framing outright; matches the CSP
  // `frame-ancestors 'none'` set in proxy.ts (when both are present browsers
  // honour frame-ancestors, so the two MUST agree).
  { key: "X-Frame-Options", value: "DENY" },
  // Deny the high-risk powerful features by default; opt in per-feature later.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@repo/ui",
    "@repo/api",
    "@repo/auth",
    "@repo/flags",
    "@repo/i18n",
    "@repo/navigation",
    "@repo/realtime",
    "@repo/telemetry",
    "@repo/validators",
    "@repo/utils",
    "@repo/config",
    // The rebuild core the step-6 surfaces run on. Now BUILT (NodeNext dist)
    // packages (ADR 0053) — kept here so Next applies its transform pipeline
    // uniformly; harmless for pre-compiled ESM. (@repo/fixtures is no longer a
    // runtime source — ADR 0060 serves the catalog from the api; it remains a
    // test-only devDependency.)
    "@repo/model",
    "@repo/engine",
    "@repo/renderers",
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    // In mock mode the BFF route handler (app/api/[...path]/route.ts) serves
    // /api/auth/* from @repo/api-mocks; these rewrites are `beforeFiles` (they
    // must win over that filesystem route to bypass the BFF hop), so emitting
    // them would shadow the mocks — gate them off entirely (ADR 0018).
    // PostHog ingestion reverse-proxy (ADR 0036): first-party /ingest/* —
    // ad-blocker-resistant; point NEXT_PUBLIC_POSTHOG_HOST at /ingest to use.
    const posthogIngest = [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ];
    if (mocksEnabled) return { beforeFiles: posthogIngest, afterFiles: [], fallback: [] };
    return {
      beforeFiles: [
        // Better Auth mounts at `/api/auth/*` ON the api service (auth.module.ts)
        // — forwarded verbatim. The versioned API has NO `/api` prefix (routes
        // are `/v1/...`), so the browser-facing `/api/v1/*` strips `/api` here,
        // mirroring what the BFF route handler does in-process.
        { source: "/api/auth/:path*", destination: `${apiProxyTarget}/api/auth/:path*` },
        { source: "/api/v1/:path*", destination: `${apiProxyTarget}/v1/:path*` },
        ...posthogIngest,
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

// Sentry build plugin (ADR 0021): source-map upload runs ONLY on release
// builds where `SENTRY_AUTH_TOKEN` (+ SENTRY_ORG/SENTRY_PROJECT) is set in the
// environment; a local/CI `next build` without it skips the upload silently
// and never fails. Runtime init lives in instrumentation{,-client}.ts.
export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !env.SENTRY_AUTH_TOKEN },
});
