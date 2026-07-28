import { describe, expect, it } from "vitest";

import { redactAttributes, REDACTED, safeUrlOrRedact } from "./redact-attributes.js";

const FASTIFY_SCOPE = "@fastify/otel";
const IOREDIS_SCOPE = "@opentelemetry/instrumentation-ioredis";
const PG_SCOPE = "@opentelemetry/instrumentation-pg";

describe("safeUrlOrRedact (ADR 0131, mirrors @repo/telemetry)", () => {
  it("keeps the path and drops the querystring of a relative url.path value", () => {
    expect(safeUrlOrRedact("/v1/clients?search=Nováková")).toBe("/v1/clients");
  });

  it("cannot let userinfo survive, because the answer is rebuilt from parser fields", () => {
    expect(safeUrlOrRedact("https://novakova:8001011234@evil.cz/x?q=1")).toBe("https://evil.cz/x");
    // The protocol-relative form is the one that escaped two earlier rounds.
    expect(safeUrlOrRedact("//novakova:8001011234@evil.cz/x")).toBe("//evil.cz/x");
  });

  it("redacts rather than passes through when the value is not one parseable url", () => {
    // Unlisted scheme: nothing here says how to reduce a `javascript:` body.
    expect(safeUrlOrRedact("javascript:alert(document.cookie)")).toBe(REDACTED);
    // A data: URI carries its payload in the body, so there is nothing to keep.
    expect(safeUrlOrRedact("data:text/csv,jan@example.cz")).toBe(REDACTED);
    // Whitespace or a comma means this is not ONE url — redact whole.
    expect(safeUrlOrRedact("/a.png, //novakova:800101@evil.cz/x")).toBe(REDACTED);
    // Unparseable as an absolute AND unparseable against the synthetic base.
    expect(safeUrlOrRedact("http://")).toBe(REDACTED);
  });

  it("reduces a db connection string to scheme + host, keeping the host", () => {
    expect(safeUrlOrRedact("postgresql://app:hunter2@db.internal:5432/perimetra")).toBe(
      "postgresql://db.internal:5432/perimetra",
    );
  });
});

describe("redactAttributes (ADR 0131)", () => {
  it("strips the querystring @fastify/otel puts in url.path, and leaves http.route alone", () => {
    const overwrites = redactAttributes(FASTIFY_SCOPE, {
      "fastify.root": "@fastify/otel",
      "http.request.method": "GET",
      "url.path": "/v1/customers?search=Nov%C3%A1kov%C3%A1&email=jan%40example.cz",
      "http.route": "/v1/customers",
    });

    expect(overwrites["url.path"]).toBe("/v1/customers");
    expect(overwrites["url.path"]).not.toContain("search");
    expect(overwrites["url.path"]).not.toContain("Nov");
    // The low-cardinality route template is authored by us and must survive —
    // it is what every RED dashboard groups by.
    expect(overwrites).not.toHaveProperty("http.route");
    expect(overwrites).not.toHaveProperty("http.request.method");
  });

  it("redacts a sensitive key wholesale, whatever namespace it sits in", () => {
    const overwrites = redactAttributes(FASTIFY_SCOPE, {
      "http.request.header.authorization": "Bearer abc.def.ghi",
      "app.customer.email": "jan@example.cz",
      "enduser.id": "usr_01H",
      "net.peer.ip": "203.0.113.9",
      "db.postgresql.values": ["Nováková"],
      "app.customer.ico": 27074358,
    });

    expect(overwrites["http.request.header.authorization"]).toBe(REDACTED);
    expect(overwrites["app.customer.email"]).toBe(REDACTED);
    expect(overwrites["enduser.id"]).toBe(REDACTED);
    expect(overwrites["net.peer.ip"]).toBe(REDACTED);
    // Non-string values are redacted too — a sensitive key is sensitive whatever
    // shape its value has.
    expect(overwrites["db.postgresql.values"]).toBe(REDACTED);
    expect(overwrites["app.customer.ico"]).toBe(REDACTED);
  });

  it("does NOT redact infrastructure names that a bare-word rule would eat", () => {
    // `name` is a pii() column in the pino/Sentry vocabulary and a database host
    // in this one. Redacting these would be data corruption, not redaction.
    const overwrites = redactAttributes(PG_SCOPE, {
      "db.name": "perimetra",
      "net.peer.name": "db.internal",
      "service.name": "skeleton-api",
      "db.user": "app",
      "net.peer.port": 5432,
    });

    expect(overwrites).toEqual({});
  });

  it("reduces an ioredis db.statement to the command name (keys carry the client IP)", () => {
    const overwrites = redactAttributes(IOREDIS_SCOPE, {
      // What @opentelemetry/redis-common's default serializer emits for a
      // throttle read: args: -1 for GET, and the key embeds the caller's IP.
      "db.statement": "get throttle:default:203.0.113.9",
      "db.connection.string": "redis://cache.internal:6379",
    });

    expect(overwrites["db.statement"]).toBe("get");
    expect(overwrites["db.statement"]).not.toContain("203.0.113.9");
    // The connection string goes through the parser and comes back IDENTICAL —
    // there was nothing in it to drop. That is the point of reducing rather than
    // allow-listing: a credential-free value is not overwritten, and a
    // credential-bearing one (`redis://:secret@cache:6379`) could not have been.
    expect(overwrites).not.toHaveProperty("db.connection.string");
  });

  it("leaves pg's parameterized sql text untouched (enhancedDatabaseReporting is off)", () => {
    const statement = 'select "id", "name" from "customer" where "id" = $1';
    const overwrites = redactAttributes(PG_SCOPE, { "db.statement": statement });

    expect(overwrites).not.toHaveProperty("db.statement");
  });

  it("redacts db.statement from any instrumentation whose shape we have not modelled", () => {
    const overwrites = redactAttributes("@opentelemetry/instrumentation-mongodb", {
      "db.statement": '{"email":"jan@example.cz"}',
    });

    expect(overwrites["db.statement"]).toBe(REDACTED);
  });

  it("returns only changed entries, and nothing at all for a clean span", () => {
    expect(
      redactAttributes(FASTIFY_SCOPE, {
        "http.route": "/v1/quotes/:id",
        "http.response.status_code": 200,
        "url.path": "/v1/quotes/abc",
      }),
    ).toEqual({});
  });
});
