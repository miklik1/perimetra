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
    // the property instead of half-scrubbing it. Every case below carries an
    // href, which is what the ADR 1018 gate requires before dropping — an
    // ambiguous chain with NO href is a provable no-op and is kept (tested
    // separately below).
    for (const chain of [
      String.raw`a:href="/search?q=\"jane doe\""nth-child="2";div:nth-child="1"`,
      String.raw`a:href="/path\";b:attr__href="/checkout?token=SUPERSECRET"`,
      String.raw`a:href="/x?a=1\";customer=Novakova";div:nth-child="1"`,
    ]) {
      const out = sanitizeAnalyticsProperties({ $elements_chain: chain });
      expect(out.$elements_chain).toBe("[Filtered]");
    }
  });

  it("keeps element detail on an ordinary chain, where the quotes alternate exactly", () => {
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

  it("scrubs the real href when an element's text ends in a planted `href=`", () => {
    // ADR 1018 defect 1. posthog-js folds the clicked element's `text` into the
    // chain and sorts attributes with localeCompare, which puts `text` last —
    // immediately before the ancestor's attr__href. The old rule inferred the
    // match START from the literal bytes `href="`, so this label opened a bogus
    // match whose closing group was the REAL href's opening quote; lastIndex
    // landed past it and the token shipped. Repro page:
    //   <a href="/invite/accept?token=SUPERSECRET"><span>Paste the value after href=</span></a>
    const scrubbed = sanitizeAnalyticsProperties({
      $elements_chain:
        'span:nth-child="1"text="Paste the value after href=";a:attr__href="/invite/accept?token=SUPERSECRET"nth-child="2"',
    }).$elements_chain;
    expect(scrubbed).not.toContain("SUPERSECRET");
    expect(scrubbed).toBe(
      'span:nth-child="1"text="Paste the value after href=";a:attr__href="/invite/accept"nth-child="2"',
    );
  });

  it("keeps an ambiguous chain intact when it contains no href at all", () => {
    // ADR 1018 defect 2 (over-redaction). The drop is gated on the chain actually
    // containing an href: with no `href="` bytes anywhere, this scrub's only
    // mutation is provably a no-op, so `[Filtered]` destroyed the whole element
    // tree while removing nothing. Most autocapture events are clicks on buttons
    // and divs with no href, and one straight double quote in a Czech UI label is
    // enough to make the chain ambiguous.
    const chain = String.raw`button:attr__aria-label="Smazat \"Faktura 42\""nth-child="3";div:nth-child="1"`;
    expect(sanitizeAnalyticsProperties({ $elements_chain: chain })).toEqual({
      $elements_chain: chain,
    });
  });

  it("carries the property key into an ARRAY of URL strings", () => {
    // The array branch used to pass "" as the key, which disarmed every key-gated
    // branch for an array of strings. A relative href has no `://` and no dotted
    // `//host`, so the generic embedded-URL pass cannot see it — it kept its query
    // while the identical scalar was stripped. Nothing else catches it: this sink
    // runs no value-shape pass, and the Sentry walk's URL key list deliberately
    // excludes these names.
    expect(
      sanitizeAnalyticsProperties({
        href: ["/clients?search=Novakova", "/orders#token=abc"],
        $current_url: ["https://app.cz/c?search=Novakova"],
      }),
    ).toEqual({
      href: ["/clients", "/orders"],
      $current_url: ["https://app.cz/c"],
    });
    // An array of OBJECTS still works: the object branch restores real keys.
    expect(sanitizeAnalyticsProperties({ $elements: [{ href: "/c?search=X" }] })).toEqual({
      $elements: [{ href: "/c" }],
    });
    // Nested arrays inherit the key at every level.
    expect(sanitizeAnalyticsProperties({ attr__href: [["/deep?token=T"]] })).toEqual({
      attr__href: [["/deep"]],
    });
  });

  it("applies the chain rules to a chain nested inside an array", () => {
    // Carrying the key through means an array element under $elements_chain
    // reaches the chain branch — including its drop-on-ambiguity path, which
    // returns a sentinel for the whole element rather than a scrubbed string.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: [
          'a:attr__href="/checkout?token=SUPERSECRET"nth-child="1"',
          String.raw`a:href="/x?a=1\";customer=Novakova";div:nth-child="1"`,
        ],
      }),
    ).toEqual({
      $elements_chain: ['a:attr__href="/checkout"nth-child="1"', "[Filtered]"],
    });
  });

  it("scrubs an odd-quote-count chain rather than round-tripping it unchanged", () => {
    // Pins the CORRECTED claim (ADR 1018). It is NOT true that a malformed or
    // odd-quote-count chain "round-trips unchanged": with one quote, split yields
    // two segments, the loop still visits index 1, and the unterminated tail goes
    // through dropUrlQuery. That behaviour is right — the no-`\"` precondition
    // means a REAL delimiter opened the segment, so it is a truncated href value
    // and scrubbing it is the intended over-redaction (posthog-js truncating a
    // long chain mid-value is the realistic producer).
    expect(
      sanitizeAnalyticsProperties({ $elements_chain: 'a:attr__href="/p?q=1' }).$elements_chain,
    ).toBe('a:attr__href="/p');
    // What the narrow claim DOES promise: nothing outside an identified href
    // value is altered. Structure-only and href-less chains are byte-preserved.
    for (const chain of ['div:nth-child="1', 'div:nth-child="1"text="no href here', '"']) {
      expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(chain);
    }
  });

  it("admits namespaced and dotted href attribute names by design, at a stated cost", () => {
    // The boundary class excludes only `a-z0-9_-`, so `:` and `.` satisfy it.
    // WANTED: xlink:href is a real link attribute (React renders xlinkHref to
    // exactly that name) and must be scrubbed.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'svg:attr__xlink:href="/p?token=SECRET"nth-child="1"',
      }).$elements_chain,
    ).toBe('svg:attr__xlink:href="/p"nth-child="1"');
    // ACCEPTED COST: a framework binding expression that survives into the DOM is
    // truncated at its TERNARY `?`. Over-redaction of autocapture detail, never a
    // leak. Narrowing the class to exclude `:` would drop xlink:href coverage —
    // the wrong trade for this module.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'a:attr__x-bind:href="isAdmin ? adminUrl : userUrl"nth-child="1"',
      }).$elements_chain,
    ).toBe('a:attr__x-bind:href="isAdmin "nth-child="1"');
    // Still excluded: a non-name character must PRECEDE the (optional) attr__
    // prefix, so a name merely ENDING in the letters `href` is not an href.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'a:attr__data-xhref="/p?keep=1"nth-child="1"',
      }).$elements_chain,
    ).toBe('a:attr__data-xhref="/p?keep=1"nth-child="1"');
  });

  it("does not trust quote parity when an unescaped tag_name quote shifts it", () => {
    // ADR 1020 — a real leak, reproduced by driving posthog-js's own serializer
    // over jsdom. posthog-js escapes attribute keys/values but concatenates
    // `element.tag_name` RAW, and the HTML tokenizer appends a `"` to a tag name
    // (`<span"x>` parses to localName `span"x`). The injected quote carries NO
    // backslash, so CHAIN_HAS_AMBIGUOUS_ESCAPE never fires; parity shifts by one,
    // every href value lands on an EVEN index, and the chain passed through
    // BYTE-IDENTICAL — zero redaction, not partial.
    const chain =
      'span"x:attr__href="/clients?search=Novakova&rc=7001011234"nth-child="1"text="Klienti";a:attr__href="/clients?search=Novakova&rc=7001011234"nth-child="1"';
    expect(chain).not.toContain(String.raw`\"`); // the old guard's only tell is absent
    const out = sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain;
    expect(out).not.toContain("Novakova");
    expect(out).toBe("[Filtered]"); // parity unverifiable + href present ⇒ drop
    // CONTROL: the byte-identical chain with a well-formed tag name scrubs
    // normally, so the injected quote is the whole difference.
    expect(
      sanitizeAnalyticsProperties({ $elements_chain: chain.replace('span"x', "span") })
        .$elements_chain,
    ).toBe(
      'span:attr__href="/clients"nth-child="1"text="Klienti";a:attr__href="/clients"nth-child="1"',
    );
  });

  it("is not fooled by an EVEN number of injected tag_name quotes", () => {
    // An odd-quote-COUNT check would be an insufficient fix: two injections
    // restore an even count while still shifting parity for the first href.
    const chain = 'a"b:attr__href="/c?q=PII1"nth-child="1";d"e:attr__href="/c?q=PII2"nth-child="1"';
    expect((chain.match(/"/g) ?? []).length % 2).toBe(0);
    const out = sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain;
    expect(out).not.toContain("PII1");
    expect(out).not.toContain("PII2");
  });

  it("keeps the grammar check from disturbing the deliberate behaviours above", () => {
    // The even-index-ends-in-`=` invariant holds for every chain the rules above
    // deliberately preserve, so closing the injection costs none of them.
    // Truncated odd-quote chain — still the intended over-redaction, not a drop.
    expect(
      sanitizeAnalyticsProperties({ $elements_chain: 'a:attr__href="/p?q=1' }).$elements_chain,
    ).toBe('a:attr__href="/p');
    // href-less / structure-only chains — byte-preserved.
    for (const chain of ['div:nth-child="1', 'div:nth-child="1"text="no href here', '"']) {
      expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(chain);
    }
    // The ADR 1018 planted-`href=` label still scrubs (its even segments all end in `=`).
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain:
          'span:nth-child="1"text="Paste the value after href=";a:attr__href="/invite/accept?token=SUPERSECRET"nth-child="2"',
      }).$elements_chain,
    ).toBe(
      'span:nth-child="1"text="Paste the value after href=";a:attr__href="/invite/accept"nth-child="2"',
    );
  });

  it("gates the ambiguity drop case-insensitively (HREF= is reachable)", () => {
    // The /i is NOT justified by "SVG in foreign content preserves case" — HTML
    // tokenization lowercases attribute names unconditionally. It IS reachable via
    // setAttribute on an SVG-namespace element and via XHTML, and posthog-js keys
    // the chain off the raw attribute name. An ambiguous chain carrying an
    // uppercase HREF must still be dropped, not passed through.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: String.raw`a:attr__HREF="/x?a=1\";customer=Novakova"`,
      }).$elements_chain,
    ).toBe("[Filtered]");
  });
});
