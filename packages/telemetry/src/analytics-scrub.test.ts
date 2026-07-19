import { describe, expect, it } from "vitest";

import { sanitizeAnalyticsProperties } from "./analytics-scrub";

describe("sanitizeAnalyticsProperties", () => {
  it("drops the query of the autocaptured $current_url / $referrer (path kept)", () => {
    expect(
      sanitizeAnalyticsProperties({
        $current_url: "https://app.example.com/clients?search=Novakova&page=2",
        $referrer: "https://google.com/search?q=Novakova",
        $pathname: "/clients",
      }),
    ).toEqual({
      $current_url: "https://app.example.com/clients",
      $referrer: "https://google.com/search",
      $pathname: "/clients",
    });
  });

  it("keeps a non-URL referrer ($direct) and structural scalars untouched", () => {
    const props = {
      $referrer: "$direct",
      $referring_domain: "$direct",
      $device_id: "0192a4f2-1111-7abc-8def-000000000000",
      $time: 1_752_710_400.123,
      $screen_height: 1080,
      $sdk_debug_retry_queue_size: 0,
    };
    expect(sanitizeAnalyticsProperties(props)).toEqual(props);
  });

  it("preserves the deliberate identify person payload (email/username never redacted)", () => {
    // The audited $set payload from `client.identify` — a blind PII walk would
    // `[Filtered]` these; the analytics scrub is URL-query-only, so they survive.
    expect(sanitizeAnalyticsProperties({ email: "user@example.com", username: "novak_m" })).toEqual(
      { email: "user@example.com", username: "novak_m" },
    );
  });

  it("strips a bare relative href (leading slash, no scheme) under a URL key", () => {
    expect(sanitizeAnalyticsProperties({ href: "/products?q=shoes&promo=x" })).toEqual({
      href: "/products",
    });
    expect(
      sanitizeAnalyticsProperties({ $external_click_url: "https://out.io/go?ref=abc" }),
    ).toEqual({ $external_click_url: "https://out.io/go" });
  });

  it("recurses into $initial_* person props and autocaptured $elements arrays", () => {
    expect(
      sanitizeAnalyticsProperties({
        $set: {
          $initial_current_url: "https://app.example.com/x?token=zzz",
          $initial_referrer: "https://ref.io/a?q=1",
        },
        $elements: [{ tag_name: "a", attr__href: "/detail?id=42&email=a@b.cz", $el_text: "Open" }],
      }),
    ).toEqual({
      $set: {
        $initial_current_url: "https://app.example.com/x",
        $initial_referrer: "https://ref.io/a",
      },
      $elements: [{ tag_name: "a", attr__href: "/detail", $el_text: "Open" }],
    });
  });

  it("strips only the embedded-URL query of a free-text prop, leaving its shapes", () => {
    // $el_text is not a URL key: an embedded URL loses its query, but an email in
    // the same free text is NOT redacted (that policy is the Sentry sink's).
    expect(
      sanitizeAnalyticsProperties({
        $el_text: "email a@b.cz or visit https://app/x?utm=abc",
      }),
    ).toEqual({ $el_text: "email a@b.cz or visit https://app/x" });
  });

  it("scrubs hrefs inside $elements_chain without shredding the chain", () => {
    // The serialized element tree rides EVERY $autocapture and is the field
    // PostHog ingestion reads. It is whitespace-free, so a generic free-text
    // pass would either miss a relative href (no "://") or run past the closing
    // quote of an absolute one and destroy every following attribute/ancestor.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain:
          'a:attr__href="/clients?search=Novakova"nth-child="2"nth-of-type="1";div:nth-child="1"',
      }),
    ).toEqual({
      $elements_chain: 'a:attr__href="/clients"nth-child="2"nth-of-type="1";div:nth-child="1"',
    });
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain:
          'a.btn:attr__href="https://app.example.com/clients?search=Novakova"nth-child="2";div:nth-child="1"',
      }),
    ).toEqual({
      $elements_chain:
        'a.btn:attr__href="https://app.example.com/clients"nth-child="2";div:nth-child="1"',
    });
  });

  it("drops the whole chain when posthog's escaping makes it unparseable", () => {
    // posthog-js escapes a literal `"` as `\"` but never escapes a backslash, so
    // a `\"` is ambiguous between an escaped quote and a value ending in a
    // literal backslash before the real delimiter. Three parsing strategies were
    // tried and all leaked; whoever controls an href controls the bytes any
    // heuristic reads. So the presence of `\"` — the one reliable tell — drops
    // the property instead of half-scrubbing it.
    for (const chain of [
      String.raw`a:href="/search?q=\"jane doe\""nth-child="2";div:nth-child="1"`,
      String.raw`a:href="/path\";b:attr__href="/checkout?token=SUPERSECRET"`,
      String.raw`a:href="/x?a=1\";customer=Novakova";div:nth-child="1"`,
    ]) {
      const out = sanitizeAnalyticsProperties({ $elements_chain: chain });
      expect(out.$elements_chain).toBe("[Filtered]");
    }
  });

  it('keeps element detail on an ordinary chain, where [^"]* is exact', () => {
    // With no `\"` anywhere, every quote IS a real delimiter — the common case,
    // so autocapture detail survives.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'a:href="/x?q=1"nth-child="2";a:attr__href="/y?surname=Novakova"nth="3"',
      }),
    ).toEqual({
      $elements_chain: 'a:href="/x"nth-child="2";a:attr__href="/y"nth="3"',
    });
  });

  it("scrubs every href in a multi-element chain", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'a:href="/a?x=1"nth-child="2";a:attr__href="/b?surname=Novakova"nth="3"',
      }),
    ).toEqual({
      $elements_chain: 'a:href="/a"nth-child="2";a:attr__href="/b"nth="3"',
    });
  });

  it("strips a scheme-less relative href under a URL key (no url-shape gate)", () => {
    // A URL-named key means the value IS a URL — including forms no shape test
    // recognises. A derived app's hand-written anchor emits exactly these.
    expect(
      sanitizeAnalyticsProperties({ attr__href: "?search=Novakova", href: "products?q=shoes" }),
    ).toEqual({ attr__href: "", href: "products" });
  });
});
