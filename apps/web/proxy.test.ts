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
vi.mock("@repo/auth", () => ({ getSessionCookie: () => null }));

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

  it("locks frame-ancestors and base-uri to 'self'", async () => {
    const csp = await buildCsp("n");
    const d = directives(csp);
    expect(d.get("frame-ancestors")).toBe("'self'");
    expect(d.get("base-uri")).toBe("'self'");
  });
});
