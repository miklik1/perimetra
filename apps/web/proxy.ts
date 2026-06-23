import { NextResponse, type NextRequest } from "next/server";

import { getSessionCookie } from "@repo/auth";
import { env } from "@repo/config/env/web";

/**
 * The single request-time hook (Next 16 `proxy`, the renamed middleware). It
 * owns two cross-cutting concerns:
 *
 * 1. **Security headers / CSP (ADR 0026).** A fresh per-request nonce is minted
 *    and a strict, nonce-based Content-Security-Policy is set on every HTML
 *    response. The nonce is forwarded on a request header (`x-nonce`) so the
 *    RSC layout can read it (`headers()`) and pass it to the inline no-FOUC
 *    theme `<script>` — so that script runs under the strict policy with **no**
 *    `unsafe-inline` for scripts. The static header set (HSTS, X-Frame-Options,
 *    etc.) lives in `next.config.js` `headers()`; only the per-request CSP is
 *    here, because it carries the nonce.
 *
 * 2. **Coarse auth gate (design §7.1).** For protected routes the httpOnly
 *    Better Auth session cookie is checked for PRESENCE (not validity — that
 *    needs the API service; the docs warn this must never authorize anything),
 *    so a visitor with NO session is redirected to `/login` before any RSC
 *    renders. `<AuthGuard>` stays the authoritative client check.
 */

/** Routes that require a session cookie to be present. */
const PROTECTED_PREFIXES = ["/account", "/projects", "/configurator", "/site", "/admin"];

export function buildCsp(nonce: string): string {
  const isDev = env.NODE_ENV !== "production";
  // Telemetry origin (ADR 0021): when a Sentry DSN is configured, its origin is
  // allowed in connect-src so ingestion isn't blocked by the policy.
  const sentryOrigin = (() => {
    const dsn = env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return undefined;
    try {
      return new URL(dsn).origin;
    } catch {
      return undefined;
    }
  })();
  // PostHog origin (ADR 0028) — analytics/flags ingestion.
  const posthogOrigin = env.NEXT_PUBLIC_POSTHOG_HOST;
  // Centrifugo websocket origin (ADR 0029) — the realtime LIVE badge. Dev's
  // blanket `ws:` already covers the local stack; this entry matters for prod
  // (wss://...). Same default as app/realtime-provider.tsx.
  const realtimeOrigin = (() => {
    try {
      return new URL(env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:8000/connection/websocket")
        .origin;
    } catch {
      return undefined;
    }
  })();

  const connectSrc = ["'self'", sentryOrigin, posthogOrigin, realtimeOrigin]
    .filter(Boolean)
    // Dev needs the HMR websocket; `next dev` connects to ws://localhost.
    .concat(isDev ? ["ws:"] : []);

  const directives = [
    `default-src 'self'`,
    // Strict script policy: only same-origin + this request's nonce. Dev adds
    // 'unsafe-eval' (React Refresh / Turbopack require it); never in prod.
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next/Tailwind inject styles at runtime; 'unsafe-inline' for styles only
    // (not scripts) is the documented Next.js CSP tradeoff.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src ${connectSrc.join(" ")}`,
    // Standalone deploy — only this origin may frame the app.
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ];
  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  // Auth gate first: a missing session cookie on a protected route short-circuits
  // to /login before we bother computing a CSP for a redirect.
  const isProtected = PROTECTED_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));
  // `getSessionCookie` covers the bare + `__Secure-` cookie names; the API
  // service uses the `__Host-` prefix in production (design §7.1), which it
  // does not check, so that spelling is covered explicitly.
  const hasSessionCookie =
    getSessionCookie(request) !== null || request.cookies.has("__Host-better-auth.session_token");
  if (isProtected && !hasSessionCookie) {
    // Carry where the visitor was headed so the login form can send them back
    // (read + re-validated through `safeNextPath` on the client — the value is
    // never trusted on the way back out). The original path is server-derived
    // here, but it round-trips through a user-editable query param, so the
    // open-redirect guard lives on the consuming side.
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  // Per-request nonce (ADR 0026). base64 of 16 random bytes.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = buildCsp(nonce);

  // Forward the nonce to the render via a request header so the RSC layout can
  // read it (`headers()`) and stamp the inline script with it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Run on all routes EXCEPT Next internals and static assets — the CSP only
  // needs to cover HTML documents (and the auth gate only matters for routes).
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|woff2?)$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
