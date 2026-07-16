import { describe, expect, it } from "vitest";

import { buildRedactPaths, redactedReqSerializer, stripQueryString } from "./redaction.js";

/**
 * pino redact-path builder (ADR 0036/0040). The guard that bites: a multi-word
 * pii() column is `ip_address` in the registry but `ipAddress` on a logged body
 * / Drizzle row, so a snake-only `req.body.ip_address` path silently no-ops.
 * buildRedactPaths must emit BOTH casings.
 */
describe("buildRedactPaths", () => {
  it("always redacts the static auth-material headers", () => {
    const paths = buildRedactPaths();
    expect(paths).toContain("req.headers.authorization");
    expect(paths).toContain("req.headers.cookie");
    // Referer can replay a token-bearing URL back into the access log (ADR 0040).
    expect(paths).toContain("req.headers.referer");
    expect(paths).toContain('res.headers["set-cookie"]');
  });

  it("emits BOTH snake_case and camelCase body paths for a multi-word pii column", () => {
    const paths = buildRedactPaths();
    // session.ip_address / session.user_agent are registered pii() columns
    // (loaded via the side-effecting `@repo/db/schema` import in redaction.ts).
    for (const camel of ["ipAddress", "userAgent"]) {
      expect(paths).toContain(`req.body.${camel}`);
      expect(paths).toContain(`res.body.${camel}`);
    }
    // The snake form stays too (a raw DB-shaped log object still matches).
    expect(paths).toContain("req.body.ip_address");
  });

  it("emits one body path per casing for a single-word column (email)", () => {
    const paths = buildRedactPaths();
    expect(paths.filter((p) => p === "req.body.email")).toHaveLength(1);
  });
});

/**
 * The `req.url` half of the redaction guarantee. pino's stock request
 * serializer logs `originalUrl ?? url`, querystring included, so a redact path
 * cannot reach a `?q=` term spliced into the url string. `stripQueryString`
 * cuts it at the one shared source — if any endpoint grows a search over a
 * `pii()` column, the term never reaches a log line or a Sentry breadcrumb.
 */
describe("stripQueryString", () => {
  it("cuts the querystring so a `?q=` search term never reaches a log line", () => {
    expect(stripQueryString("/v1/projects?q=jan.novak@example.com")).toBe("/v1/projects");
    expect(stripQueryString("/v1/projects?q=Nováková&cursor=abc")).toBe("/v1/projects");
  });

  it("leaves a query-less url untouched", () => {
    expect(stripQueryString("/v1/projects")).toBe("/v1/projects");
  });

  it("handles an empty query and a bare `?`", () => {
    expect(stripQueryString("/v1/projects?")).toBe("/v1/projects");
  });
});

describe("redactedReqSerializer", () => {
  // The input is pino-http's ALREADY-serialized request shape (see the fn's
  // docstring), not a raw req — so the fixture carries url/query/remoteAddress.
  const serialized = (over = {}) =>
    ({
      method: "GET",
      url: "/v1/projects?q=jan.novak@example.com",
      query: { q: "jan.novak@example.com" },
      headers: { host: "x" },
      remoteAddress: "203.0.113.7",
      remotePort: 54321,
      ...over,
    }) as unknown as Parameters<typeof redactedReqSerializer>[0];

  it("cuts the querystring from `url` and drops the parsed `query` object", () => {
    const out = redactedReqSerializer(serialized());
    expect(out.url).toBe("/v1/projects");
    expect(out).not.toHaveProperty("query");
    expect(JSON.stringify(out)).not.toContain("jan.novak@example.com");
  });

  it("preserves the correlation fields it must not touch", () => {
    const out = redactedReqSerializer(serialized()) as unknown as Record<string, unknown>;
    expect(out.method).toBe("GET");
    // remoteAddress/remotePort MUST survive — the double-serialization bug this
    // guards against silently dropped them from every log line.
    expect(out.remoteAddress).toBe("203.0.113.7");
    expect(out.remotePort).toBe(54321);
  });

  it("keeps remoteAddress through the REAL pino-http wiring (no double-serialization)", async () => {
    // pino-http wraps a custom req serializer so it receives an ALREADY-
    // serialized req; a serializer that re-runs stdSerializers.req drops
    // remoteAddress/remotePort (derived from req.socket, gone after pass 1).
    // Driving the real transport is the only test that catches that class —
    // calling the function in isolation does not.
    // Type pino-http's default export as a minimal callable — its CJS/ESM
    // interop type is awkward under NodeNext and irrelevant to what we assert.
    const pinoHttp = (await import("pino-http")).default as unknown as (
      opts: unknown,
      stream: unknown,
    ) => { logger: { info: (obj: unknown, msg: string) => void } };
    const chunks: string[] = [];
    const dest = { write: (c: string) => void chunks.push(c) };
    const mw = pinoHttp({ serializers: { req: redactedReqSerializer } }, dest);
    mw.logger.info(
      {
        req: {
          method: "GET",
          url: "/v1/projects?q=secret@example.com",
          headers: { host: "x" },
          socket: { remoteAddress: "203.0.113.7", remotePort: 54321 },
        },
      },
      "t",
    );
    const line = JSON.parse(chunks.join("")) as { req: Record<string, unknown> };
    expect(line.req.remoteAddress).toBe("203.0.113.7");
    expect(line.req.url).toBe("/v1/projects");
    expect(line.req).not.toHaveProperty("query");
    expect(JSON.stringify(line.req)).not.toContain("secret@example.com");
  });
});

describe("referer redaction (redact.paths, real pino-http pipeline)", () => {
  it("censors req.headers.referer end-to-end so a token-bearing URL never lands in the log", async () => {
    // The referer leak is a redact-PATHS concern, invisible to a serializer-only
    // unit test — only the REAL pipeline with `redact.paths` configured catches
    // it. Removing "req.headers.referer" from STATIC_PATHS reddens this test
    // (the mutation guard the ADR 0040 amendment demands).
    const pinoHttp = (await import("pino-http")).default as unknown as (
      opts: unknown,
      stream: unknown,
    ) => { logger: { info: (obj: unknown, msg: string) => void } };
    const chunks: string[] = [];
    const dest = { write: (c: string) => void chunks.push(c) };
    const mw = pinoHttp(
      {
        redact: { paths: buildRedactPaths(), censor: "[redacted]" },
        serializers: { req: redactedReqSerializer },
      },
      dest,
    );
    mw.logger.info(
      {
        req: {
          method: "GET",
          url: "/dashboard",
          headers: {
            host: "x",
            referer: "https://app.example.com/reset-password?token=abc123secret",
          },
          socket: { remoteAddress: "203.0.113.7", remotePort: 54321 },
        },
      },
      "t",
    );
    const line = JSON.parse(chunks.join("")) as { req: { headers: { referer: string } } };
    expect(line.req.headers.referer).toBe("[redacted]");
    expect(JSON.stringify(line.req)).not.toContain("abc123secret");
  });
});
