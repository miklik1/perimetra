import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `buildCsp` reads the validated env (NODE_ENV + telemetry/realtime origins) and
// composes the per-request Content-Security-Policy (ADR 0026). Drive it through
// a mutable mocked env so each case controls NODE_ENV + which origins are set.
// `@repo/auth` is mocked too so importing `proxy.ts` stays hermetic (no
// better-auth/cookies pull-in for a pure CSP test).
const envState = vi.hoisted(
  () =>
    ({
      NODE_ENV: "production",
      NEXT_PUBLIC_SENTRY_DSN: undefined,
      NEXT_PUBLIC_POSTHOG_HOST: undefined,
      NEXT_PUBLIC_REALTIME_URL: undefined,
    }) as {
      NODE_ENV: string;
      NEXT_PUBLIC_SENTRY_DSN: string | undefined;
      NEXT_PUBLIC_POSTHOG_HOST: string | undefined;
      NEXT_PUBLIC_REALTIME_URL: string | undefined;
    },
);

vi.mock("@repo/config/env/web", () => ({ env: envState }));
vi.mock("@repo/auth", () => ({
  // Mirror the real presence-only check for the prod `__Host-` cookie name
  // without pulling in better-auth/cookies (keeps the CSP test hermetic).
  hasSessionCookie: (req: Request) =>
    (req.headers.get("cookie") ?? "").includes("__Host-auth_session_token="),
}));

async function buildCsp(nonce: string): Promise<string> {
  vi.resetModules();
  const mod = await import("./proxy");
  return mod.buildCsp(nonce);
}

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split("; ").map((d) => {
      const [name, ...rest] = d.split(" ");
      return [name ?? "", rest.join(" ")] as const;
    }),
  );
}

beforeEach(() => {
  envState.NODE_ENV = "production";
  envState.NEXT_PUBLIC_SENTRY_DSN = undefined;
  envState.NEXT_PUBLIC_POSTHOG_HOST = undefined;
  envState.NEXT_PUBLIC_REALTIME_URL = undefined;
});

afterEach(() => {
  vi.resetModules();
});

describe("buildCsp", () => {
  it("includes the request nonce in script-src", async () => {
    const csp = await buildCsp("abc123");
    expect(directives(csp).get("script-src")).toContain("'nonce-abc123'");
  });

  it("includes the Sentry origin in connect-src when a DSN is set", async () => {
    envState.NEXT_PUBLIC_SENTRY_DSN = "https://abc@o1.ingest.sentry.io/1";
    const csp = await buildCsp("n");
    expect(directives(csp).get("connect-src")).toContain("https://o1.ingest.sentry.io");
  });

  it("includes the PostHog origin in connect-src when its host is set", async () => {
    envState.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
    const csp = await buildCsp("n");
    expect(directives(csp).get("connect-src")).toContain("https://eu.i.posthog.com");
  });

  it("includes the realtime origin in connect-src", async () => {
    envState.NEXT_PUBLIC_REALTIME_URL = "wss://realtime.example.com/connection/websocket";
    const csp = await buildCsp("n");
    expect(directives(csp).get("connect-src")).toContain("wss://realtime.example.com");
  });

  it("adds 'unsafe-eval' to script-src in development, never in production", async () => {
    envState.NODE_ENV = "development";
    const dev = await buildCsp("n");
    expect(directives(dev).get("script-src")).toContain("'unsafe-eval'");

    envState.NODE_ENV = "production";
    const prod = await buildCsp("n");
    expect(directives(prod).get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("denies framing (frame-ancestors 'none') and locks base-uri to 'self'", async () => {
    const csp = await buildCsp("n");
    const d = directives(csp);
    // 'none', not 'self': when a response carries both CSP frame-ancestors AND
    // X-Frame-Options, browsers honour frame-ancestors — so 'self' would
    // silently allow same-origin framing despite the X-Frame-Options: DENY.
    expect(d.get("frame-ancestors")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'self'");
  });
});

async function loadProxy() {
  vi.resetModules();
  return import("./proxy");
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url));
}

function cspNonce(response: { headers: Headers }): string | undefined {
  const csp = response.headers.get("content-security-policy") ?? "";
  return /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
}

describe("proxy", () => {
  it("sets a nonce-bearing CSP on the response for a public route", async () => {
    const { proxy } = await loadProxy();
    const csp =
      proxy(makeRequest("http://localhost/")).headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
  });

  it("mints a fresh nonce per request", async () => {
    const { proxy } = await loadProxy();
    const first = cspNonce(proxy(makeRequest("http://localhost/")));
    const second = cspNonce(proxy(makeRequest("http://localhost/")));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("forwards the same nonce to the render on the x-nonce request header", async () => {
    const { proxy } = await loadProxy();
    const res = proxy(makeRequest("http://localhost/"));
    // NextResponse.next({ request: { headers } }) re-exposes overridden request
    // headers via x-middleware-request-*, so the RSC layout reads the same nonce
    // it stamps onto the inline no-FOUC theme <script> (ADR 0026).
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(cspNonce(res));
  });

  it("redirects an unauthenticated visitor off a protected route to /login with ?next=", async () => {
    const { proxy } = await loadProxy();
    const res = proxy(makeRequest("http://localhost/account/settings?tab=billing"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "", "http://localhost");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/account/settings?tab=billing");
    // The middleware redirect must still carry the static security headers — it
    // bypasses next.config.js `headers()`, so a first-visit HTTP hit on a
    // protected route would otherwise reach /login with no HSTS / framing guard.
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("lets an authenticated prod user carrying the __Host- session cookie through a protected route", async () => {
    // The API renames the session cookie to __Host-auth_session_token in prod
    // (auth.instance.ts); getSessionCookie() only knows the bare/__Secure-
    // default names, so this spelling must be recognized by hasSessionCookie() —
    // the old inline check looked for the wrong "__Host-better-auth..." name and
    // locked these users out.
    const { proxy } = await loadProxy();
    const req = new NextRequest(new URL("http://localhost/account/settings"), {
      headers: { cookie: "__Host-auth_session_token=valid-session-token" },
    });
    const res = proxy(req);
    // Authed → no redirect to /login (a CSP response, not a 307).
    expect(res.status).not.toBe(307);
  });
});
