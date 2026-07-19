"use client";

import posthog from "posthog-js";
import { useState } from "react";

import {
  createDebugMiddleware,
  createRetryMiddleware,
  errorContext,
  makeQueryClient,
} from "@repo/api";
import { ApiProvider } from "@repo/api/react";
import { AuthProvider } from "@repo/auth/react";
import { env } from "@repo/config/env/web";
import type { FlagsBootstrap } from "@repo/flags";
import { FlagsProvider } from "@repo/flags/web";
import { getTelemetry, sanitizeAnalyticsProperties } from "@repo/telemetry";

import { NavShell } from "../components/nav-shell";
import { AnalyticsIdentity } from "./analytics-identity";
import { RealtimeProvider } from "./realtime-provider";
import { ThemeEffect } from "./theme-effect";
import { Toaster } from "./toaster";

// Same-origin BFF transport (ADR 0018): the client talks to `/api`, never the
// backend directly. `/api/auth/*` + `/api/v1/*` are rewritten to the API
// service (next.config.js); everything else hits the route handler, which
// proxies to the real backend (or serves mocks server-side).
const baseUrl = "/api";

// Retry/backoff/429 transport (ADR 0012), with the dev-only request logger
// composed OUTERMOST so it times the whole chain (gated so it tree-shakes out
// of production bundles). The old 401→refresh→retry middleware is gone: the
// session is an httpOnly cookie the API service refreshes server-side (Better
// Auth, design §7.1) — there is no client-held token to re-mint.
const middleware =
  env.NEXT_PUBLIC_DEBUG_API === "true"
    ? [createDebugMiddleware(), createRetryMiddleware()]
    : [createRetryMiddleware()];

// Every error that SURFACES from a query/mutation (after retries) is captured
// with its API context — the explicit-DI half of ADR 0021 (the QueryClient is
// constructed at boot, so no global reach-in is needed here). The field list
// lives with ApiError (`errorContext`), not here.
function onQueryError(error: unknown): void {
  getTelemetry().captureException(error, errorContext(error));
}

/**
 * Client providers. Auth is the Better Auth client (design §7.1): the session
 * rides an httpOnly cookie through the same-origin proxy, so the API client
 * needs no `getToken`, no refresh middleware, and there is no SessionMonitor /
 * AuthBridge — refresh is server-side and tabs share the cookie jar.
 * `<AuthProvider>` (no `baseUrl` — same-origin) sits inside `<ApiProvider>` so
 * `useAuth` can clear the QueryClient on logout. Dev mocks are served by the
 * BFF route handler (ADR 0018), so there is no browser service worker here.
 *
 * `<FlagsProvider>` (ADR 0028) carries this request's server-evaluated flag
 * bootstrap (threaded from the RSC layout) and runs `posthog.init` with it —
 * the shared client the instrumentation boot already wired into both the
 * flags and analytics carriers. It sits inside `<AuthProvider>` with
 * `<AnalyticsIdentity>` (the auth → identify/setUser bridge) as its child.
 */
export function Providers({
  children,
  flagsBootstrap,
}: {
  children: React.ReactNode;
  flagsBootstrap?: FlagsBootstrap;
}) {
  // Built here (not defaulted inside ApiProvider) to thread the telemetry
  // onError hook; useState initializer = once per mount, same as ApiProvider's.
  const [queryClient] = useState(() => makeQueryClient({ onError: onQueryError }));
  return (
    <ApiProvider baseUrl={baseUrl} middleware={middleware} initialQueryClient={queryClient}>
      <AuthProvider>
        {/* Realtime (ADR 0029): builds the client lazily — no socket until a
            consumer (the projects LIVE badge) calls connect(). Inside
            ApiProvider because the token getters ride `apiFetch`. */}
        <RealtimeProvider>
          <FlagsProvider
            client={posthog}
            bootstrap={flagsBootstrap}
            apiKey={env.NEXT_PUBLIC_POSTHOG_KEY}
            host={env.NEXT_PUBLIC_POSTHOG_HOST}
            sanitizeProperties={sanitizeAnalyticsProperties}
          >
            <AnalyticsIdentity />
            <ThemeEffect />
            {/* Persistent nav shell (CAR-12) — ABOVE `{children}` so it survives
                client-side navigation between surfaces. Lives here (not one
                level up in layout.tsx) because it reads `useAuth`/`/v1/me`,
                which need this component's Auth + Api context. */}
            <NavShell />
            {children}
            <Toaster />
          </FlagsProvider>
        </RealtimeProvider>
      </AuthProvider>
    </ApiProvider>
  );
}
