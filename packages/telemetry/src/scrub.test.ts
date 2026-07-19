import { describe, expect, it } from "vitest";

import {
  dropUrlQuery,
  redactString,
  scrubBreadcrumb,
  scrubDescription,
  scrubEvent,
  scrubSpan,
  scrubTransaction,
  stripEmbeddedUrlQueries,
} from "./scrub";

const FILTERED = "[Filtered]";

describe("redactString", () => {
  it.each([
    ["bearer token", "auth failed: Bearer eyJabc.def123-x_y", `auth failed: ${FILTERED}`],
    ["bare JWT", "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVP", `token=${FILTERED}`],
    ["email", "user john.doe+test@example.co.uk not found", `user ${FILTERED} not found`],
    ["rodné číslo with slash", "rc 900720/0004 rejected", `rc ${FILTERED} rejected`],
    ["rodné číslo spaced slash", "rc 900720 / 0004 rejected", `rc ${FILTERED} rejected`],
    ["slashless 10-digit RČ shape", "value 9007200004 invalid", `value ${FILTERED} invalid`],
    ["9-digit pre-1954 shape", "value 530101123 invalid", `value ${FILTERED} invalid`],
  ])("redacts %s", (_name, input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it("leaves non-PII text untouched", () => {
    expect(redactString("GET /users?page=2 → 404 in 12345678 ns")).toBe(
      "GET /users?page=2 → 404 in 12345678 ns",
    );
    expect(redactString("order 12345 for user abc")).toBe("order 12345 for user abc");
  });
});

describe("scrubEvent", () => {
  it("walks nested structures, arrays included", () => {
    const event = {
      message: "login failed for john@example.com",
      extra: {
        attempts: [{ note: "rc 900720/0004" }, { note: "ok" }],
        count: 3,
      },
    };
    expect(scrubEvent(event)).toEqual({
      message: `login failed for ${FILTERED}`,
      extra: {
        attempts: [{ note: `rc ${FILTERED}` }, { note: "ok" }],
        count: 3,
      },
    });
  });

  it("redacts sensitive keys wholesale, wherever they sit", () => {
    const event = {
      request: {
        headers: { Authorization: "whatever shape", cookie: "sid=1" },
      },
      user: { email: "a@b.cz", id: "u1" },
      extra: { refresh_token: { nested: "object" }, password: "hunter2" },
    };
    expect(scrubEvent(event)).toEqual({
      request: { headers: { Authorization: FILTERED, cookie: FILTERED } },
      user: { email: FILTERED, id: "u1" },
      extra: { refresh_token: FILTERED, password: FILTERED },
    });
  });

  it("redacts every pii()-registered column name (packages/db/src/pii.ts, ADR 0040)", () => {
    // The PII registry drives this scrubber: a column tagged pii() must never
    // reach Sentry in the clear. These are the current registered bare names —
    // name/email/image (user), ip_address/user_agent (session), identifier
    // (verification). Add a row here when a new pii() column lands.
    const event = {
      user: { name: "Jane", email: "a@b.cz", image: "https://cdn/x.png", id: "u1" },
      session: { ip_address: "203.0.113.4", user_agent: "Mozilla/5.0", expiresAt: "soon" },
      verification: { identifier: "jane@b.cz", value: "tok" },
    };
    expect(scrubEvent(event)).toEqual({
      user: { name: FILTERED, email: FILTERED, image: FILTERED, id: "u1" },
      session: { ip_address: FILTERED, user_agent: FILTERED, expiresAt: "soon" },
      verification: { identifier: FILTERED, value: "tok" },
    });
  });

  it("is pure — the input event is not mutated", () => {
    const event = { message: "mail a@b.cz", extra: { token: "t" } };
    const copy = structuredClone(event);
    scrubEvent(event);
    expect(event).toEqual(copy);
  });

  it("survives circular references without recursing forever", () => {
    type Node = { message: string; self?: unknown };
    const event: Node = { message: "ok" };
    event.self = event;
    expect(() => scrubEvent(event)).not.toThrow();
    expect(scrubEvent(event).message).toBe("ok");
  });

  it("clones diamond-shaped sharing instead of dropping the second reference", () => {
    const shared = { note: "mail a@b.cz", count: 1 };
    expect(scrubEvent({ a: shared, b: shared })).toEqual({
      a: { note: `mail ${FILTERED}`, count: 1 },
      b: { note: `mail ${FILTERED}`, count: 1 },
    });
    expect(scrubEvent([shared, shared])).toEqual([
      { note: `mail ${FILTERED}`, count: 1 },
      { note: `mail ${FILTERED}`, count: 1 },
    ]);
  });

  it("leaves structural SDK metadata untouched (source-map safety)", () => {
    const event = {
      release: "build-1234567890",
      environment: "production",
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                // Pure-numeric chunk name + dotted symbol would otherwise match
                // the RČ / JWT shapes.
                { filename: "/_next/static/chunks/123456789.js", function: "appModule.render.run" },
              ],
            },
            value: "login failed for john@example.com",
          },
        ],
      },
    };
    expect(scrubEvent(event)).toEqual({
      release: "build-1234567890",
      environment: "production",
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: "/_next/static/chunks/123456789.js", function: "appModule.render.run" },
              ],
            },
            value: `login failed for ${FILTERED}`,
          },
        ],
      },
    });
  });

  it("still redacts sensitive keys even when they look structural", () => {
    // SENSITIVE_KEYS wins over the structural exemption (no current overlap —
    // this pins the precedence should one ever appear under both).
    expect(scrubEvent({ email: "a@b.cz", filename: "ok.js" })).toEqual({
      email: FILTERED,
      filename: "ok.js",
    });
  });

  it("preserves null/undefined and non-object primitives", () => {
    expect(scrubEvent(null)).toBeNull();
    expect(scrubEvent(42)).toBe(42);
    expect(scrubEvent({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs message and data like an event", () => {
    expect(
      scrubBreadcrumb({ message: "fetch as john@example.com", data: { token: "abc" } }),
    ).toEqual({ message: `fetch as ${FILTERED}`, data: { token: FILTERED } });
  });
});

// ── URL query stripping (ADR 1011) ──────────────────────────────────────────
// The deny-BY-DEFAULT layer: pattern redaction is a deny-LIST (it only knows
// email/JWT/Bearer/RČ shapes), so an arbitrary `?search=<surname>` param — the
// PII value with NO recognisable shape — sails through unless we drop the query
// wholesale. Keep the path (trace stays debuggable); drop the query.
describe("dropUrlQuery", () => {
  it("keeps origin+path, drops the query string", () => {
    expect(dropUrlQuery("https://app.example.com/api/users?search=Novak&page=2")).toBe(
      "https://app.example.com/api/users",
    );
  });

  it("drops the fragment too", () => {
    expect(dropUrlQuery("https://app.example.com/x#tok=abc")).toBe("https://app.example.com/x");
  });

  it("cuts at the FIRST delimiter (query before fragment or vice versa)", () => {
    expect(dropUrlQuery("/path#frag?still-gone")).toBe("/path");
  });

  it("leaves a query-less URL untouched", () => {
    expect(dropUrlQuery("https://app.example.com/api/users")).toBe(
      "https://app.example.com/api/users",
    );
  });
});

describe("scrubEvent — URL query stripping", () => {
  it("strips the query from a fetch breadcrumb url (the reported leak class)", () => {
    // A surname typed into a search box rides in ?search=; no value pattern
    // matches it, so only the deny-by-default query strip catches it.
    const breadcrumb = {
      category: "fetch",
      data: { url: "https://app.example.com/api/clients?search=Nov%C3%A1kov%C3%A1", method: "GET" },
    };
    expect(scrubBreadcrumb(breadcrumb)).toEqual({
      category: "fetch",
      data: { url: "https://app.example.com/api/clients", method: "GET" },
    });
  });

  it("strips the query from navigation breadcrumb to/from paths", () => {
    expect(
      scrubBreadcrumb({
        category: "navigation",
        data: { from: "/list?q=a@b.cz", to: "/detail?id=7&secret=x" },
      }),
    ).toEqual({ category: "navigation", data: { from: "/list", to: "/detail" } });
  });

  it("drops a bare query_string / url.query / search value wholesale (no path to keep)", () => {
    expect(
      scrubEvent({
        request: { url: "https://app/api/users?token=abc", query_string: "search=Novak&page=2" },
        breadcrumbHint: { search: "personal note" },
      }),
    ).toEqual({
      request: { url: "https://app/api/users", query_string: FILTERED },
      breadcrumbHint: { search: FILTERED },
    });
  });

  it("still pattern-redacts a token baked into the surviving URL PATH", () => {
    // dropUrlQuery keeps the path; a JWT in the path is still a value shape we
    // catch, so the two layers compose.
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVP";
    expect(scrubBreadcrumb({ data: { url: `https://app/reset/${jwt}?next=/home` } })).toEqual({
      data: { url: `https://app/reset/${FILTERED}` },
    });
  });
});

describe("scrubDescription", () => {
  it("drops the query from an HTTP request-line description", () => {
    expect(scrubDescription("GET https://api.example.com/clients?search=Novak")).toBe(
      "GET https://api.example.com/clients",
    );
  });

  it("does NOT truncate a SQL description at its bind-placeholder '?'", () => {
    // A db.query description is not URL-shaped — cutting at "?" would destroy
    // the statement. Pattern redaction still runs (email below is redacted).
    expect(scrubDescription("SELECT * FROM users WHERE id = ? AND email = 'a@b.cz'")).toBe(
      `SELECT * FROM users WHERE id = ? AND email = '${FILTERED}'`,
    );
  });

  it("does NOT treat a SQL DELETE as an HTTP request line (DELETE is both)", () => {
    // The regex requires a URL/path token after the verb, so "DELETE FROM …"
    // (SQL) is not query-stripped and its bind "?" survives; only "DELETE /path"
    // or "DELETE https://…" (real HTTP) is.
    expect(scrubDescription("DELETE FROM users WHERE id = ? AND email = 'a@b.cz'")).toBe(
      `DELETE FROM users WHERE id = ? AND email = '${FILTERED}'`,
    );
    expect(scrubDescription("DELETE https://api.example.com/clients/7?token=x")).toBe(
      "DELETE https://api.example.com/clients/7",
    );
  });

  it("does NOT truncate a free-text description with trailing prose (only a pure request line)", () => {
    // A real span description IS the whole request line; a value that begins
    // like one but carries trailing prose is a free-text field (a bug report) —
    // truncating it at "?" would destroy triage context. The end-anchor spares it.
    expect(scrubDescription("POST /api/checkout?coupon=SAVE20 returns 500 every time")).toBe(
      "POST /api/checkout?coupon=SAVE20 returns 500 every time",
    );
  });
});

// ── ADR 1013 gap fixes: ws/protocol-relative embedded URLs + transaction name ─
describe("redactString — ws/protocol-relative embedded URLs (ADR 1013 gap fix)", () => {
  it("strips the query of an embedded ws(s):// URL", () => {
    expect(redactString("connect wss://rt.app/socket?token=abc123 failed")).toBe(
      "connect wss://rt.app/socket failed",
    );
    expect(redactString("ws://rt.app/s?jwt=x")).toBe("ws://rt.app/s");
  });

  it("strips the query of an embedded protocol-relative URL with a dotted host", () => {
    expect(redactString("asset //cdn.app.com/a?search=Novak here")).toBe(
      "asset //cdn.app.com/a here",
    );
    // Guarded by a DOTTED host: a bare comment / non-host "//" is NOT truncated.
    expect(redactString("see // note?maybe later")).toBe("see // note?maybe later");
    // A :port is part of the authority — without it the host group ends at the
    // ":" and the whole match fails, leaving the query intact.
    expect(redactString("fetch //api.stg.example.com:8443/c?search=Novakova")).toBe(
      "fetch //api.stg.example.com:8443/c",
    );
  });

  it("consumes the whole non-whitespace query run, so nothing can be stranded", () => {
    // perimetra rejects upstream's carrier-sparing bound: any rule that infers
    // the query's end from local context can be defeated by planting that shape
    // inside the value. These three all leaked under earlier carrier-sparing
    // designs; the whitespace-bounded tail cannot strand them.
    for (const q of [
      '?token="abc"&surname=Novakova',
      '?tag="vip",customer=Novakova',
      '?a=x":Novakova',
    ]) {
      const out = redactString(`Visited https://a.cz/s${q} for details`);
      expect(out).toBe("Visited https://a.cz/s for details");
      expect(out).not.toContain("Novakova");
    }
  });

  it("still matches when a word character is glued to the scheme", () => {
    // A word-boundary anchor is defeated by concatenation (`request` + `http://`),
    // and the protocol-relative pass cannot cover for it on a single-label host
    // like a k8s service name — together that yielded ZERO redaction.
    expect(redactString("requesthttp://internal-svc/callback?token=SECRET&surname=Novakova")).toBe(
      "requesthttp://internal-svc/callback",
    );
    expect(redactString("0https://internalhost/p?token=SECRET")).toBe("0https://internalhost/p");
  });

  it("KNOWN LIMIT: a raw space inside a query value strands the tail", () => {
    // The tail is whitespace-bounded, so an unencoded space inside a query value
    // ends the match early. Documented rather than fixed: consuming past
    // whitespace would eat the surrounding prose, and the URL's true end is not
    // knowable in free text. Pre-dates this ADR (perimetra's shipped `\S*` does
    // the same). A real URL percent-encodes the space; a hand-written or decoded
    // one in a log line may not. Tracked as owed — see ADR 1013 Consequences.
    expect(redactString("Navigated to https://shop.cz/search?q=Jana Novakova")).toBe(
      "Navigated to https://shop.cz/search Novakova",
    );
  });

  it("sacrifices a structured carrier rather than risk stranding PII", () => {
    // The accepted cost of the whitespace-bounded tail: a URL inside a JSON-ish
    // carrier takes the rest of the carrier with it. An observability loss, by
    // design — the alternative was a leak.
    expect(redactString('{"url":"https://a/b?c=1","user":"x"}')).toBe('{"url":"https://a/b');
  });

  it("strips a protocol-relative URL's query, and leaves a non-URL alone", () => {
    expect(redactString("cdn at //cdn.acme.cz/x?surname=Novakova end")).toBe(
      "cdn at //cdn.acme.cz/x end",
    );
    expect(redactString("//cdn.acme.cz:8443/x?c=1 end")).toBe("//cdn.acme.cz:8443/x end");
    // The dotted-host guard keeps a bare comment from being truncated at "?".
    expect(redactString("// is this a comment? yes")).toBe("// is this a comment? yes");
  });

  it("stripEmbeddedUrlQueries cuts URL queries WITHOUT redacting value shapes", () => {
    expect(stripEmbeddedUrlQueries("mailto a@b.cz see https://app/x?token=zzz")).toBe(
      "mailto a@b.cz see https://app/x",
    );
    expect(stripEmbeddedUrlQueries("user a@b.cz")).toBe("user a@b.cz");
  });
});

describe("scrubTransaction (ADR 1013 gap fix)", () => {
  it("drops the query of a request-line OR bare-route name, not free text", () => {
    expect(scrubTransaction("GET /api/clients?search=Novakova")).toBe("GET /api/clients");
    expect(scrubTransaction("/api/clients?search=Novakova")).toBe("/api/clients");
    expect(scrubTransaction("https://a.co/clients?search=x")).toBe("https://a.co/clients");
    expect(scrubTransaction("checkout flow (retry?)")).toBe("checkout flow (retry?)");
  });

  it("scrubEvent strips the query from the event `transaction` name", () => {
    expect(scrubEvent({ transaction: "GET /api/clients?search=Novakova" })).toEqual({
      transaction: "GET /api/clients",
    });
    expect(scrubEvent({ transaction: "/api/clients?search=Novakova" })).toEqual({
      transaction: "/api/clients",
    });
  });
});

// ── Review-found leak surfaces (ADR 1011, adversarial pass 2026-07-16) ───────
describe("scrubEvent — referer / description / free-text / to-from surfaces", () => {
  it("strips the query from the Referer header (default httpContextIntegration leak)", () => {
    // event.request.headers.Referer = document.referrer (full URL + query) on
    // every browser error/transaction — not a shape, not a PII key, so only the
    // URL-field strip catches it.
    expect(
      scrubEvent({
        request: { headers: { Referer: "https://app.example.com/clients?search=Novakova" } },
      }),
    ).toEqual({ request: { headers: { Referer: "https://app.example.com/clients" } } });
  });

  it("strips the query from a span description embedded in a transaction event's spans[]", () => {
    // beforeSendTransaction routes the whole event (incl. spans[] + contexts.trace)
    // through scrubEvent, NOT scrubSpan — the description key must be handled here.
    const result = scrubEvent({
      type: "transaction",
      transaction: "GET /api/clients",
      spans: [
        { span_id: "abc", op: "http.client", description: "GET https://api/clients?search=X" },
      ],
      contexts: { trace: { op: "http.client", description: "GET /api/clients?search=X" } },
    }) as {
      spans: { description: string }[];
      contexts: { trace: { description: string } };
    };
    expect(result.spans[0]!.description).toBe("GET https://api/clients");
    expect(result.contexts.trace.description).toBe("GET /api/clients");
  });

  it("strips an absolute URL query embedded in a free-text message", () => {
    expect(scrubEvent({ message: "GET https://app/api/clients?search=Novakova failed" })).toEqual({
      message: "GET https://app/api/clients failed",
    });
  });

  it("strips to/from query ONLY when URL-shaped — never truncates free text", () => {
    expect(
      scrubEvent({
        nav: { from: "/list?q=a@b.cz", to: "/detail?id=7" },
        dialog: { from: "Are you sure? yes", to: "confirmed" },
      }),
    ).toEqual({
      nav: { from: "/list", to: "/detail" },
      dialog: { from: "Are you sure? yes", to: "confirmed" },
    });
  });

  it("strips the query from every element of a url-keyed array", () => {
    expect(scrubEvent({ data: { url: ["https://a/x?q=1", "https://b/y?q=2"] } })).toEqual({
      data: { url: ["https://a/x", "https://b/y"] },
    });
  });

  it("leaves a free-text 'description' field with trailing prose intact", () => {
    expect(
      scrubEvent({ extra: { description: "POST /api/checkout?coupon=X returns 500" } }),
    ).toEqual({ extra: { description: "POST /api/checkout?coupon=X returns 500" } });
  });

  it("does not stack-overflow on a cyclic array under a url key", () => {
    const arr: unknown[] = [];
    arr.push(arr);
    expect(() => scrubEvent({ url: arr })).not.toThrow();
  });
});

describe("scrubSpan", () => {
  it("strips the query from url.full but keeps the path, drops url.query wholesale", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVP";
    const result = scrubSpan({
      span_id: "abc123",
      trace_id: "trace456",
      op: "http.client",
      description: "GET https://api.example.com/clients?search=Novak",
      data: {
        "url.full": `https://api.example.com/clients?token=${jwt}`,
        "url.query": "search=Novak&step=2",
        "http.method": "GET",
        "http.status_code": 200,
      },
      start_timestamp: 0,
    });
    // Structural ids intact.
    expect(result.span_id).toBe("abc123");
    expect(result.op).toBe("http.client");
    // Description: HTTP request line → query dropped, path kept.
    expect(result.description).toBe("GET https://api.example.com/clients");
    // url.full: query dropped, path kept (no ?token= leak, no FILTERED marker).
    expect(result.data!["url.full"]).toBe("https://api.example.com/clients");
    // url.query: bare query → dropped wholesale.
    expect(result.data!["url.query"]).toBe(FILTERED);
    // Non-PII values pass through unchanged.
    expect(result.data!["http.method"]).toBe("GET");
    expect(result.data!["http.status_code"]).toBe(200);
  });

  it("redacts a sensitive-key value in span data (db.statement email)", () => {
    const result = scrubSpan({
      op: "db.query",
      description: "SELECT email FROM users WHERE email = 'user@example.com'",
      data: { "db.statement": "email = 'user@example.com'" },
    });
    expect(result.description).not.toContain("user@example.com");
    expect(result.description).toContain(FILTERED);
    expect(result.data!["db.statement"]).toContain(FILTERED);
  });

  it("passes a span with no data through untouched", () => {
    expect(scrubSpan({ op: "ui.render", description: "render" })).toEqual({
      op: "ui.render",
      description: "render",
    });
  });

  it("strips the query from the span referer attribute (httpContextIntegration)", () => {
    const result = scrubSpan({
      op: "pageload",
      data: { "http.request.header.referer": "https://app.example.com/clients?search=Novakova" },
    });
    expect(result.data!["http.request.header.referer"]).toBe("https://app.example.com/clients");
  });

  it("recurses into a NESTED object under a span data key (symmetry with the event walk)", () => {
    // scrubSpan must not pass an object-valued data attribute through raw —
    // nested PII (email, RČ, a url query) must be scrubbed like the event walk.
    const result = scrubSpan({
      op: "custom",
      data: {
        "extra.ctx": { email: "alice@example.com", note: "rc 900720/0004", url: "https://a/x?q=1" },
      },
    });
    expect(result.data!["extra.ctx"]).toEqual({
      email: FILTERED,
      note: `rc ${FILTERED}`,
      url: "https://a/x",
    });
  });
});
