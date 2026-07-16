import { describe, expect, it } from "vitest";

import { scrubEvent } from "./init.js";

type AnyEvent = Parameters<typeof scrubEvent>[0];

describe("sentry scrubEvent (ADR 0040)", () => {
  it("drops cookies/auth headers and masks PII-registry + secret keys", () => {
    const event = {
      request: {
        cookies: { session: "x" },
        headers: { cookie: "a=b", authorization: "Bearer x", accept: "application/json" },
      },
      extra: {
        // `email`/`name` are pii() columns (user table); `password` is a secret key.
        email: "martin@example.test",
        password: "hunter2",
        nested: { name: "Martin", safe: "keep-me" },
      },
      contexts: { state: { email: "x@y.cz", count: 3 } },
    } as unknown as AnyEvent;

    const scrubbed = scrubEvent(event) as unknown as {
      request: { cookies?: unknown; headers: Record<string, string> };
      extra: { email: string; password: string; nested: { name: string; safe: string } };
      contexts: { state: { email: string; count: number } };
    };

    expect(scrubbed.request.cookies).toBeUndefined();
    expect(scrubbed.request.headers.cookie).toBeUndefined();
    expect(scrubbed.request.headers.authorization).toBeUndefined();
    expect(scrubbed.request.headers.accept).toBe("application/json");
    expect(scrubbed.extra.email).toBe("[scrubbed]");
    expect(scrubbed.extra.password).toBe("[scrubbed]");
    expect(scrubbed.extra.nested.name).toBe("[scrubbed]");
    expect(scrubbed.extra.nested.safe).toBe("keep-me");
    expect(scrubbed.contexts.state.email).toBe("[scrubbed]");
    expect(scrubbed.contexts.state.count).toBe(3);
  });

  it("masks a MULTI-WORD pii column under its camelCase key (ipAddress/userAgent)", () => {
    // session.ip_address / session.user_agent are pii() columns; a Drizzle row
    // or body carries them as ipAddress / userAgent. A snake-only key set
    // silently misses these — the regression this guards.
    const event = {
      extra: { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0", safe: "keep-me" },
    } as unknown as AnyEvent;

    const scrubbed = scrubEvent(event) as unknown as {
      extra: { ipAddress: string; userAgent: string; safe: string };
    };

    expect(scrubbed.extra.ipAddress).toBe("[scrubbed]");
    expect(scrubbed.extra.userAgent).toBe("[scrubbed]");
    expect(scrubbed.extra.safe).toBe("keep-me");
  });
});

describe("sentry scrubEvent request-PII surfaces (ADR 1009)", () => {
  it("drops the five request-derived PII surfaces, no PII term surviving anywhere", () => {
    const event = {
      request: {
        // 2. url with a `?search=<email>` querystring (path must be retained).
        url: "https://api.test/v1/clients?search=martin@example.test",
        // 1. raw, unparsed request body blob (key-scrub cannot reach it).
        data: "email=martin@example.test&password=hunter2",
        // 3. parsed querystring.
        query_string: "search=martin@example.test",
        headers: {
          // 4. referer/referrer carry the origin page URL incl. querystring.
          referer: "https://app.test/clients?search=martin@example.test",
          referrer: "https://app.test/clients?q=martin@example.test",
          accept: "application/json",
        },
      },
      // 5. outgoing-request breadcrumb (e.g. the PostHog purge fetch).
      breadcrumbs: [
        {
          category: "http",
          data: {
            url: "https://eu.posthog.com/api/persons/?distinct_id=u-1",
            "http.query": "?distinct_id=u-1",
            "http.fragment": "#martin@example.test",
            method: "GET",
          },
        },
        { category: "log", message: "noop" }, // no `data` — must be tolerated
      ],
    } as unknown as AnyEvent;

    const scrubbed = scrubEvent(event) as unknown as {
      request: {
        url: string;
        data?: unknown;
        query_string?: unknown;
        headers: Record<string, string>;
      };
      breadcrumbs: { data?: Record<string, unknown> }[];
    };

    // 1. raw body blob dropped wholesale.
    expect(scrubbed.request.data).toBeUndefined();
    // 2. querystring cut off the url; the path survives.
    expect(scrubbed.request.url).toBe("https://api.test/v1/clients");
    // 3. parsed querystring dropped.
    expect(scrubbed.request.query_string).toBeUndefined();
    // 4. referer + referrer dropped; an unrelated header is kept.
    expect(scrubbed.request.headers.referer).toBeUndefined();
    expect(scrubbed.request.headers.referrer).toBeUndefined();
    expect(scrubbed.request.headers.accept).toBe("application/json");
    // 5. breadcrumb query surfaces dropped; data.url querystring cut; safe kept.
    const crumb = scrubbed.breadcrumbs[0]!.data!;
    expect(crumb["http.query"]).toBeUndefined();
    expect(crumb["http.fragment"]).toBeUndefined();
    expect(crumb.url).toBe("https://eu.posthog.com/api/persons/");
    expect(crumb.method).toBe("GET");

    // The terminal guarantee: no PII term survives ANYWHERE in the event.
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain("martin@example.test");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("distinct_id=u-1");
  });

  it("tolerates absent breadcrumbs and breadcrumbs without data", () => {
    expect(() =>
      scrubEvent({ request: { url: "https://api.test/v1/x" } } as unknown as AnyEvent),
    ).not.toThrow();
    expect(() =>
      scrubEvent({ breadcrumbs: [{ category: "log" }] } as unknown as AnyEvent),
    ).not.toThrow();
  });
});
