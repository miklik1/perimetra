import { describe, expect, it } from "vitest";

import {
  REDACTED,
  redactString,
  safeUrlOrRedact,
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
describe("safeUrlOrRedact — ADR 1030 §1: reduced by the parser, or redacted", () => {
  it("keeps origin+path, drops the query string", () => {
    expect(safeUrlOrRedact("https://app.example.com/api/users?search=Novak&page=2")).toBe(
      "https://app.example.com/api/users",
    );
  });

  it("drops the fragment too", () => {
    expect(safeUrlOrRedact("https://app.example.com/x#tok=abc")).toBe("https://app.example.com/x");
  });

  it("leaves a query-less URL untouched in MEANING (re-serialized, not sliced)", () => {
    expect(safeUrlOrRedact("https://app.example.com/api/users")).toBe(
      "https://app.example.com/api/users",
    );
  });

  it("keeps a relative path and drops its query", () => {
    expect(safeUrlOrRedact("/clients?search=Novakova")).toBe("/clients");
    expect(safeUrlOrRedact("/path#frag?still-gone")).toBe("/path");
  });

  // ── The round-6 criticals ────────────────────────────────────────────────

  // `reducesToSingleUrl` asked whether a post-comma member was an ABSOLUTE url,
  // so a protocol-relative member was invisible and this exact value came back
  // BYTE-IDENTICAL at all four sinks in both skeletons.
  it("REDACTS a comma-joined value whose later member carries userinfo", () => {
    expect(safeUrlOrRedact("/a.png,//novakova:8001011234@evil.cz/x")).toBe(REDACTED);
  });

  it("REDACTS any list-valued attribute value, without classifying its members", () => {
    expect(safeUrlOrRedact("/a.png 1x, /b.png 2x")).toBe(REDACTED);
    expect(safeUrlOrRedact("/a /b")).toBe(REDACTED);
  });

  // ── Userinfo: dropped structurally, not by a rule ────────────────────────

  it("cannot emit userinfo — the output is built from `host`", () => {
    expect(safeUrlOrRedact("https://novakova:8001011234@evil.cz/x?y=1")).toBe("https://evil.cz/x");
    expect(safeUrlOrRedact("//novakova:8001011234@evil.cz/x")).toBe("//evil.cz/x");
  });

  it("keeps an explicit port, which is part of the authority", () => {
    expect(safeUrlOrRedact("https://api.example.com:8443/x?q=1")).toBe(
      "https://api.example.com:8443/x",
    );
  });

  // ── The scheme allow-list ────────────────────────────────────────────────

  it("REDACTS non-hierarchical schemes, whose payload IS the opaque path", () => {
    expect(safeUrlOrRedact("mailto:novakova@example.cz?subject=x")).toBe(REDACTED);
    expect(safeUrlOrRedact("tel:+420800123456")).toBe(REDACTED);
    expect(safeUrlOrRedact("sms:+420800123456")).toBe(REDACTED);
    expect(safeUrlOrRedact("geo:50.08,14.44")).toBe(REDACTED);
    expect(safeUrlOrRedact("javascript:alert(1)")).toBe(REDACTED);
  });

  // Keying opacity on the absence of `//` is defeated by exactly this value: it
  // round-trips through that test and still delivers its body.
  it("REDACTS `data:` in BOTH spellings, including the `//` form", () => {
    expect(safeUrlOrRedact("data:text/csv;base64,QQ==")).toBe(REDACTED);
    expect(safeUrlOrRedact("data://text/csv;base64,QQ==")).toBe(REDACTED);
  });

  it("REDACTS an unknown scheme rather than guessing (allow-list, not deny-list)", () => {
    expect(safeUrlOrRedact("chrome-extension://abcdef/page?token=x")).toBe(REDACTED);
    expect(safeUrlOrRedact("app://internal/x")).toBe(REDACTED);
  });

  it("keeps the native-build schemes that are on the list by provenance", () => {
    expect(safeUrlOrRedact("capacitor://localhost/clients?search=Novakova")).toBe(
      "capacitor://localhost/clients",
    );
    expect(safeUrlOrRedact("file:///var/app/index.html?token=abc")).toBe(
      "file:///var/app/index.html",
    );
  });

  // ── The two argued exemptions, pinned so they cannot widen ───────────────

  it("passes the `$direct` sentinel EXACTLY, and nothing that merely starts with it", () => {
    expect(safeUrlOrRedact("$direct")).toBe("$direct");
    expect(safeUrlOrRedact("$directory")).toBe("/$directory");
    expect(safeUrlOrRedact("$direct?x=1")).toBe("/$direct");
  });

  it("reduces `blob:` rather than passing it through — a query still dies", () => {
    expect(safeUrlOrRedact("blob:https://app.example.com/uuid-1234")).toBe(
      "blob:https://app.example.com/uuid-1234",
    );
    expect(safeUrlOrRedact("blob:https://app.example.com/uuid?search=Novakova")).toBe(
      "blob:https://app.example.com/uuid",
    );
  });

  // ── Deny-by-default residue ──────────────────────────────────────────────

  it("REDACTS a framework binding expression instead of truncating it at a ternary", () => {
    expect(safeUrlOrRedact("isAdmin ? '/admin' : '/home'")).toBe(REDACTED);
  });

  it("returns the empty string for an empty value (nothing to leak)", () => {
    expect(safeUrlOrRedact("")).toBe("");
    expect(safeUrlOrRedact("   ")).toBe("");
  });

  it("never returns an input byte it did not examine — no safe answer carries a query marker", () => {
    const hostile = [
      "https://a.cz/x?q=1",
      "//a.cz/x?q=1",
      "/x?q=1",
      "?q=1",
      "#q=1",
      "https://u:p@a.cz/x#f",
      "capacitor://localhost/x?q=1",
      "blob:https://a.cz/u?q=1",
      "mailto:a@b.cz?subject=x",
      "/a.png,//u:p@evil.cz/x",
      "data://text/csv,Novakova",
    ];
    for (const value of hostile) {
      const out = safeUrlOrRedact(value);
      if (out === REDACTED) continue;
      expect(out, `safe answer for ${value}`).not.toMatch(/[?#@]/);
    }
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
    // safeUrlOrRedact keeps the path; a JWT in the path is still a value shape we
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
    // The carrier-sparing bound is rejected: any rule inferring the query's end
    // from local context can be defeated by planting that shape in the value.
    // All three of these leaked under earlier carrier-sparing designs.
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

  it("sacrifices a structured carrier rather than risk stranding PII", () => {
    // The accepted cost of the whitespace-bounded tail: a URL inside a JSON-ish
    // carrier takes the rest of the carrier with it. Observability loss by
    // design — the alternative was a leak.
    expect(redactString('{"url":"https://a/b?c=1","user":"x"}')).toBe('{"url":"https://a/b');
  });

  it("still matches when a word character is glued to the scheme", () => {
    // A word-boundary anchor is defeated by concatenation (`request` + `http://`),
    // and the protocol-relative pass cannot cover for it on a single-label host
    // like a k8s service name — together that yielded ZERO redaction.
    expect(redactString("requesthttp://internal-svc/callback?token=SECRET&surname=Novakova")).toBe(
      "requesthttp://internal-svc/callback",
    );
  });

  it("KNOWN LIMIT: a raw space inside a query value strands the tail", () => {
    // Documented rather than fixed: consuming past whitespace would eat the
    // surrounding prose, and a URL's true end in free text is not knowable.
    expect(redactString("Navigated to https://shop.cz/search?q=Jana Novakova")).toBe(
      "Navigated to https://shop.cz/search Novakova",
    );
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

// `http.target` is path+query, NOT an absolute URL — it has no `://` and no
// dotted `//host`, so both embedded-URL passes are a no-op on it, and every
// other rule (SENSITIVE / QUERY_ONLY / STRUCTURAL / description / transaction)
// misses the key name. It is set unconditionally by Next.js on the
// `BaseServer.handleRequest` root span and by Sentry's
// `httpServerSpansIntegration`, and Sentry's OTel bridge maps span attributes
// straight onto `contexts.trace.data` / `spans[].data`, so before this rule the
// raw querystring rode the entire server tracing path in the clear. Found by
// adversarial review of a downstream drain, not by the gates.
describe("scrubEvent / scrubSpan — the http.target path+query attribute", () => {
  it("keeps the path and drops the query on a bare path+query value", () => {
    const result = scrubEvent({
      contexts: { trace: { data: { "http.target": "/clients?search=Novakova" } } },
      spans: [{ data: { "http.target": "/projects?email=a@b.cz" } }],
    }) as {
      contexts: { trace: { data: Record<string, string> } };
      spans: { data: Record<string, string> }[];
    };
    expect(result.contexts.trace.data["http.target"]).toBe("/clients");
    expect(result.spans[0]!.data["http.target"]).toBe("/projects");
  });

  it("covers the raw-span envelope too (beforeSendSpan)", () => {
    const result = scrubSpan({ data: { "http.target": "/clients?search=Novakova" } });
    expect(result.data!["http.target"]).toBe("/clients");
  });

  it("still redacts a value-shape token left in the surviving path", () => {
    // Query gone AND the path's JWT still caught by the shape patterns — the
    // URL rule composes with `redactString`, it does not replace it.
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123";
    expect(scrubSpan({ data: { "http.target": `/reset/${jwt}?x=1` } }).data!["http.target"]).toBe(
      `/reset/${FILTERED}`,
    );
  });
});

// The FRAGMENT twins of the bare-query keys. A bare fragment value has no
// scheme, so the embedded-URL passes never fire and `safeUrlOrRedact` is never
// reached — covering `http.query` but not `http.fragment` contradicted the
// module's own deny-by-default policy (`safeUrlOrRedact` never reads `hash`).
describe("scrubEvent / scrubSpan — the url.fragment / http.fragment twins", () => {
  it("drops the fragment twins wholesale, like the query keys", () => {
    expect(
      scrubSpan({ data: { "http.fragment": "section=medical-notes", "url.fragment": "x=1" } }).data,
    ).toEqual({ "http.fragment": FILTERED, "url.fragment": FILTERED });
    expect(scrubEvent({ data: { "http.fragment": "a=b" } })).toEqual({
      data: { "http.fragment": FILTERED },
    });
  });

  it("drops a fragment that arrives with NO query beside it", () => {
    // Pins the INDEPENDENCE of the two SDK writes: they are separately guarded
    // on `parsedUrl.search` / `parsedUrl.hash`, so a fragment-only URL emits
    // `http.fragment` alone. A rule that relied on a covered sibling being
    // present would leak exactly here.
    expect(scrubSpan({ data: { "http.fragment": "email=jan@example.cz" } }).data).toEqual({
      "http.fragment": FILTERED,
    });
  });
});

// ── The container-key class: a key whose CHILD names are not enumerable ──────
// `SENSITIVE_KEYS` is anchored (so `cookie` cannot eat `cookiePreferences`), and
// that same anchoring makes it blind to the PLURAL container `cookies`. The walk
// descended into the jar and tested each COOKIE NAME against the same anchored
// list — which no real session-cookie name matches — so the container has to be
// dropped wholesale instead. Found by adversarial review of a downstream drain.
describe("scrubEvent — request.cookies (the parsed cookie jar)", () => {
  it("drops the whole jar, not per-cookie-name", () => {
    // The exact PoC: `requestDataIntegration` (a DEFAULT integration) parses
    // `headers.cookie` into `request.cookies` on the ERROR path. Before this rule
    // the SAME session token was `[Filtered]` under `headers.cookie` and verbatim
    // under `request.cookies` in one event.
    const result = scrubEvent({
      request: {
        headers: { cookie: "__Host-auth_session_token=hR9m2Kd7.sIgNaTuRe; theme=dark" },
        cookies: {
          "__Host-auth_session_token": "hR9m2Kd7.sIgNaTuRe",
          "sb-access-token": "eyJhbGciOiJI",
          theme: "dark",
        },
      },
    }) as { request: Record<string, unknown> };
    expect(result.request.headers).toEqual({ cookie: FILTERED });
    expect(result.request.cookies).toBe(FILTERED);
  });

  it("pins WHY the jar must go wholesale: this repo's own cookie survives every other rule", () => {
    // `__Host-auth_session_token` (packages/auth/src/index.ts) matches no anchored
    // key rule, and its two-segment value matches no value SHAPE (the JWT pattern
    // needs three). A per-cookie-name rule would have to enumerate a vocabulary it
    // does not own; this asserts the shortfall so nobody "simplifies" the
    // container rule back into a name list.
    expect(redactString("hR9m2Kd7.sIgNaTuRe")).toBe("hR9m2Kd7.sIgNaTuRe");
    expect(scrubEvent({ "__Host-auth_session_token": "hR9m2Kd7.sIgNaTuRe" })).toEqual({
      "__Host-auth_session_token": "hR9m2Kd7.sIgNaTuRe",
    });
  });

  it("keeps the anchoring that made the plural necessary in the first place", () => {
    expect(scrubEvent({ cookiePreferences: "analytics=off" })).toEqual({
      cookiePreferences: "analytics=off",
    });
  });
});

// ── The raw request BODY: a blob no key rule reaches into, no shape matches ──
describe("scrubEvent — request.data (the raw unparsed body)", () => {
  it("drops a form-post body carrying shapeless PII", () => {
    // `include.data` is hardcoded true in requestDataIntegration and
    // httpServerIntegration captures 10KB by default. A surname has no
    // Bearer/JWT/email/RČ shape, so `redactString` alone was a no-op.
    expect(
      scrubEvent({ request: { data: "surname=Nov%C3%A1kov%C3%A1&rc_note=narozena" } }),
    ).toEqual({ request: { data: FILTERED } });
  });

  it("drops an OBJECT body too, not just a string one", () => {
    expect(scrubEvent({ request: { data: { surname: "Nováková" } } })).toEqual({
      request: { data: FILTERED },
    });
  });

  it("is scoped to `request` — the `data` ATTRIBUTE BAGS stay walkable", () => {
    // The regression this scoping exists to prevent. A global `data` rule would
    // redact the bag before the walk could reach `http.target` / `http.query` /
    // the fragment twins inside it, trading a leak for a bigger blind spot.
    expect(
      scrubEvent({
        contexts: { trace: { data: { "http.target": "/clients?search=Novakova" } } },
        spans: [{ data: { "http.query": "a=1", "http.route": "/x" } }],
        data: { url: "https://h/p?q=1", foo: "bar" },
      }),
    ).toEqual({
      contexts: { trace: { data: { "http.target": "/clients" } } },
      spans: [{ data: { "http.query": FILTERED, "http.route": "/x" } }],
      data: { url: "https://h/p", foo: "bar" },
    });
  });

  it("applies to a DIRECT child of `request` only, not to any deeper `data`", () => {
    expect(scrubEvent({ request: { other: { data: "not the body" } } })).toEqual({
      request: { other: { data: "not the body" } },
    });
  });
});

// ── The attribute-namespaced forms of names SENSITIVE_KEYS already owns ──────
// `ip[-_]?address` and `user[-_]?agent` are anchored, so they cannot see
// `http.client_ip` or `user_agent.original`. These ship as plain literals in the
// SAME `startSpan` attributes bag as `http.target` (server-subscription.js), so
// the ADR 1016 fix was read out of a literal whose neighbours still leaked.
describe("scrubEvent / scrubSpan — SDK attribute forms of PII names", () => {
  const attributes = {
    "http.client_ip": "203.0.113.42",
    "net.peer.ip": "203.0.113.42",
    "client.address": "203.0.113.42",
    "http.user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)",
    "user_agent.original": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)",
    "http.request.header.user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)",
    "http.response.header.user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4)",
    "http.request.body.data": "surname=Novakova",
    "http.request.header.cookie": "__Host-auth_session_token=hR9m2Kd7.sIgNaTuRe",
    "http.request.header.cookie.__host_auth_session_token": "hR9m2Kd7.sIgNaTuRe",
    // All four (request|response) x (set_)? arms of the cookie-attribute family.
    // ADR 1017 claims the whole family; only the two request-side arms were
    // pinned, so narrowing the regex to `request` alone would have left the
    // suite green while the ADR kept promising response coverage (ADR 1019).
    "http.request.header.set_cookie": "sid=abc; HttpOnly",
    "http.response.header.cookie": "sid=abc",
    "http.response.header.set_cookie": "sid=abc; HttpOnly",
    "http.response.header.set_cookie.connect.sid": "s%3AabcdefghijklmnopQRST",
  };
  const allFiltered = Object.fromEntries(Object.keys(attributes).map((k) => [k, FILTERED]));

  it("redacts them on contexts.trace.data (the beforeSendTransaction carrier)", () => {
    expect(scrubEvent({ contexts: { trace: { data: attributes } } })).toEqual({
      contexts: { trace: { data: allFiltered } },
    });
  });

  it("redacts them on the raw span envelope (beforeSendSpan)", () => {
    expect(scrubSpan({ data: attributes }).data).toEqual(allFiltered);
  });

  it("leaves the non-PII attributes of the same literal intact", () => {
    // `http.target` keeps its path (ADR 1016) and the structural/routing
    // attributes are untouched — this rule must not blunt trace debuggability.
    expect(
      scrubSpan({
        span_id: "1a2b3c4d",
        data: {
          "http.target": "/clients?search=Novakova",
          "http.route": "/clients",
          "http.method": "GET",
          "net.host.name": "api.example.com",
          "http.status_code": 500,
        },
      }),
    ).toEqual({
      span_id: "1a2b3c4d",
      data: {
        "http.target": "/clients",
        "http.route": "/clients",
        "http.method": "GET",
        "net.host.name": "api.example.com",
        "http.status_code": 500,
      },
    });
  });

  it("keeps net.host.* — the server's OWN local address, not the caller's", () => {
    // ADR 1019 retired the `net.host.ip` rule. `net.host.ip` has exactly two
    // writers in the installed tree and both are SERVER spans assigning
    // `localAddress` (`@sentry/core` server-subscription.js:190 and
    // `@sentry/node-core` httpServerSpansIntegration.js:216, the latter via the
    // SEMATTRS_NET_HOST_IP constant); the client-span emitter writes only
    // `net.peer.*`. So the name DOES carry the direction, and the retired
    // direction-ambiguity rationale was false. `net.peer.ip` — genuinely the
    // caller's IP on a server span — stays redacted above. This is now identical
    // to `web-native-skeleton`'s registry; the two skeletons agree.
    expect(
      scrubSpan({
        data: {
          "net.host.ip": "10.0.0.5",
          "net.host.port": 443,
          "net.host.name": "api-prod-3.internal",
          "net.peer.ip": "203.0.113.9",
        },
      }).data,
    ).toEqual({
      "net.host.ip": "10.0.0.5",
      "net.host.port": 443,
      "net.host.name": "api-prod-3.internal",
      "net.peer.ip": FILTERED,
    });
  });

  it("redacts the credential/PII vocabulary the pii() column mirror does not cover", () => {
    // ADR 1019. None of these is a `pii()` column, but neither is `password`,
    // `token` or `rodne_cislo` — this list has always been a column mirror PLUS a
    // generic vocabulary. `@repo/validators/primitives/cz.ts` MINTS iban and
    // bankAccount twenty-five lines from the rodné-číslo validator that this
    // scrubber's own header cites as its reason to exist. No STRING_PATTERN
    // matches any of these values, so the key list is the only defence.
    expect(
      scrubEvent({
        extra: {
          phone: "+420123456789",
          phone_number: "+420123456789",
          tel: "+420123456789",
          iban: "CZ6508000000192000145399",
          bank_account: "19-2000145399/0800",
          ssn: "123-45-6789",
          national_id: "AB123456",
          // The Czech abbreviation a hand-written form field actually uses.
          rc: "900720/0004",
          session_id: "abcdefghijklmnopQRST",
        },
      }),
    ).toEqual({
      extra: {
        phone: FILTERED,
        phone_number: FILTERED,
        tel: FILTERED,
        iban: FILTERED,
        bank_account: FILTERED,
        ssn: FILTERED,
        national_id: FILTERED,
        rc: FILTERED,
        session_id: FILTERED,
      },
    });
  });

  it("does NOT redact the bare `session` container — it is a pii()-column table here", () => {
    // The one deliberate divergence from web-native's registry (ADR 1019).
    // `session` is a Better Auth DB table whose `ip_address` / `user_agent` are
    // individually registered pii() columns. Redacting the container would hide
    // them behind one [Filtered] and blind the column mirror that
    // scrub.pii-contract.test.ts guards. web-native has no packages/db, so no
    // such container, which is why the bare name is safe there and not here.
    expect(
      scrubEvent({ session: { ip_address: "1.2.3.4", user_agent: "curl/8", expiresAt: "soon" } }),
    ).toEqual({
      session: { ip_address: FILTERED, user_agent: FILTERED, expiresAt: "soon" },
    });
  });

  it("keeps the new vocabulary entries anchored — no substring collateral", () => {
    // Every entry is anchored, so an app field that merely CONTAINS one of these
    // names survives. Without this, `session` would eat `session_replay_url` and
    // `tel` would eat `telemetry_enabled` — the failure mode that made `cookie`
    // vs `cookiePreferences` worth anchoring in the first place.
    expect(
      scrubEvent({
        extra: {
          telemetry_enabled: true,
          session_replay_url: "https://app/replay/7",
          ibanValidated: true,
          phone_country: "CZ",
          national_id_issuer: "MVCR",
          rcVersion: "1.2.0",
        },
      }),
    ).toEqual({
      extra: {
        telemetry_enabled: true,
        session_replay_url: "https://app/replay/7",
        ibanValidated: true,
        phone_country: "CZ",
        national_id_issuer: "MVCR",
        rcVersion: "1.2.0",
      },
    });
  });
});

// ── ADR 1031 — the Sentry-walk defects the ADR 1030 review confirmed ─────────
describe("scrubEvent / scrubSpan — ADR 1031 repairs", () => {
  it("reduces a browser stack frame whose script URL IS the page URL with its query", () => {
    // The leak: an error thrown from an inline/eval'd script gets frames whose
    // filename/abs_path is `location.href`. Both fields used to be exempt from
    // ALL redaction, so the page's search term shipped in every frame — on the
    // error path, at the default tracesSampleRate: 0.
    expect(
      scrubEvent({
        exception: {
          values: [
            {
              stacktrace: {
                frames: [
                  {
                    filename: "https://app.cz/clients?search=Novakova&rc=8001011234",
                    abs_path: "https://app.cz/clients?search=Novakova&rc=8001011234",
                    function: "submit",
                    lineno: 12,
                  },
                ],
              },
            },
          ],
        },
      }),
    ).toEqual({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  filename: "https://app.cz/clients",
                  abs_path: "https://app.cz/clients",
                  function: "submit",
                  lineno: 12,
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("leaves a SYNTHETIC or relative frame path byte-identical, so source maps still resolve", () => {
    // This is what the exemption was protecting, and it is why the rule is
    // narrow rather than "run the primitive on these keys": the primitive would
    // rewrite `ok.js` to `/ok.js` and REDACT `app:///…` as an unlisted scheme.
    expect(
      scrubEvent({
        filename: "ok.js",
        abs_path: "app:///_next/static/chunks/4823-9f2.js",
      }),
    ).toEqual({
      filename: "ok.js",
      abs_path: "app:///_next/static/chunks/4823-9f2.js",
    });
    expect(scrubEvent({ filename: "webpack-internal:///./src/app/page.tsx" })).toEqual({
      filename: "webpack-internal:///./src/app/page.tsx",
    });
    // A purely-numeric chunk name must not be rewritten by the rodné-číslo
    // pattern — the original reason these keys were exempt at all.
    expect(scrubEvent({ filename: "9007200004.js" })).toEqual({ filename: "9007200004.js" });
  });

  it("scrubs `links[].attributes` — the SECOND attribute bag on a span", () => {
    const out = scrubSpan({
      span_id: "s",
      trace_id: "t",
      description: "GET /x",
      data: { "url.full": "https://app.cz/x?search=Novakova" },
      links: [
        {
          span_id: "l1",
          attributes: {
            "url.full": "https://app.cz/x?search=Novakova",
            "http.target": "/x?search=Novakova",
            "http.route": "/x",
          },
        },
      ],
    } as never) as {
      data: Record<string, unknown>;
      links: { attributes: Record<string, unknown> }[];
    };
    // Assert SAFETY, not agreement: the payload marker must not survive in
    // EITHER bag. A parity assertion alone would pass if both leaked.
    expect(JSON.stringify(out)).not.toContain("Novakova");
    expect(out.data["url.full"]).toBe("https://app.cz/x");
    expect(out.links[0]?.attributes["url.full"]).toBe("https://app.cz/x");
    expect(out.links[0]?.attributes["http.target"]).toBe("/x");
    // The route survives — trace debuggability is the point of keeping paths.
    expect(out.links[0]?.attributes["http.route"]).toBe("/x");
  });

  it("passes a span with no links through untouched (no key invented)", () => {
    expect(scrubSpan({ span_id: "s", description: "GET /x" } as never)).not.toHaveProperty("links");
  });

  it("routes the native-build schemes through the primitive at EVERY caller, not just URL keys", () => {
    // The gate that decides whether to CALL the primitive used to know only
    // http/https, while SAFE_SCHEMES holds seven — so the three schemes added ON
    // PROVENANCE were invisible to `transaction`, `description` and `to`/`from`.
    for (const value of [
      "capacitor://localhost/detail?surname=Novakova",
      "ionic://localhost/detail?surname=Novakova",
      "file:///android_asset/www/index.html?surname=Novakova",
    ]) {
      expect(scrubTransaction(value)).not.toContain("Novakova");
      // A bare URL description (how Sentry writes resource/fetch spans).
      expect(scrubDescription(value)).not.toContain("Novakova");
      // And with a verb in front, the request-line form.
      expect(scrubDescription(`GET ${value}`)).not.toContain("Novakova");
      expect(JSON.stringify(scrubEvent({ transaction: value }))).not.toContain("Novakova");
      expect(JSON.stringify(scrubEvent({ to: value, from: value }))).not.toContain("Novakova");
    }
    // And the reduction is the primitive's, not a truncation.
    expect(scrubTransaction("capacitor://localhost/detail?surname=Novakova")).toBe(
      "capacitor://localhost/detail",
    );
  });

  it("handles a request line whose verb is outside the classic list", () => {
    for (const verb of ["TRACE", "QUERY", "CONNECT", "PROPFIND"]) {
      expect(scrubDescription(`${verb} /clients?search=Novakova`)).toBe(`${verb} /clients`);
    }
    // …without turning SQL into a request line: `DELETE FROM` has a second space,
    // so the anchored no-space-after-URL shape still rejects it.
    expect(scrubDescription("DELETE FROM users WHERE id = ?")).toBe(
      "DELETE FROM users WHERE id = ?",
    );
    expect(scrubDescription("SELECT * FROM t WHERE a = ?")).toBe("SELECT * FROM t WHERE a = ?");
  });
});
