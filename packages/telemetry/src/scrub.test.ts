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

// `http.target` is path+query, NOT an absolute URL — it has no `://` and no
// dotted `//host`, so both embedded-URL passes are a no-op on it, and every
// other rule (SENSITIVE / QUERY_ONLY / STRUCTURAL / description / transaction)
// misses the key name. It is set unconditionally by Next.js on the
// `BaseServer.handleRequest` root span and by Sentry's
// `httpServerSpansIntegration`, and Sentry's OTel bridge maps span attributes
// straight onto `contexts.trace.data` / `spans[].data`, so before this rule the
// raw querystring rode the entire server tracing path in the clear (ADR 1016).
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
    // Query gone AND the path's JWT still caught by the shape patterns — the URL
    // rule composes with `redactString`, it does not replace it.
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123";
    expect(scrubSpan({ data: { "http.target": `/reset/${jwt}?x=1` } }).data!["http.target"]).toBe(
      `/reset/${FILTERED}`,
    );
  });
});

// The FRAGMENT twins of the bare-query keys. A bare fragment value has no
// scheme, so the embedded-URL passes never fire and `dropUrlQuery` is never
// reached — covering `http.query` but not `http.fragment` contradicted the
// module's own deny-by-default policy (`dropUrlQuery` cuts at `[?#]`).
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
    // Pins the INDEPENDENCE of the two SDK writes: they are separately guarded on
    // `parsedUrl.search` / `parsedUrl.hash`, so a fragment-only URL emits
    // `http.fragment` alone. A rule that relied on a covered sibling being present
    // would leak exactly here.
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
// dropped wholesale instead (ADR 1017).
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
    // `__Host-auth_session_token` (packages/auth) matches no anchored key rule,
    // and its two-segment value matches no value SHAPE (the JWT pattern needs
    // three). A per-cookie-name rule would have to enumerate a vocabulary it does
    // not own; this asserts the shortfall so nobody "simplifies" the container
    // rule back into a name list.
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
    // ADR 1017 claims the whole family; pinning only the request-side arms would
    // let a narrowing of the regex leave the suite green while the ADR kept
    // promising response coverage.
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
    // `net.host.ip` has exactly two writers in the installed tree and both are
    // SERVER spans assigning `localAddress` (`@sentry/core` server-subscription.js
    // and `@sentry/node-core` httpServerSpansIntegration.js, the latter via the
    // SEMATTRS_NET_HOST_IP constant); the client-span emitter writes only
    // `net.peer.*`. So the name DOES carry the direction. `net.peer.ip` —
    // genuinely the caller's IP on a server span — stays redacted above (ADR 1019).
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
    // ADR 1019. Not every entry here is a `pii()` column, but neither is
    // `password`, `token` or `rodne_cislo` — this list has always been a column
    // mirror PLUS a generic vocabulary. `@repo/validators/primitives/cz.ts` MINTS
    // iban and bankAccount a few lines from the rodné-číslo validator that this
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
    // scrub.pii-contract.test.ts guards. web-native has no packages/db, so no such
    // container, which is why the bare name is safe there and not here.
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
