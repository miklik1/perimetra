import { describe, expect, it } from "vitest";

import { sanitizeAnalyticsProperties } from "./analytics-scrub";
import { REDACTED } from "./scrub";

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
    // a `\"` is ambiguous. Three parsing strategies were tried and all leaked;
    // the presence of `\"` — the one reliable tell — drops the property instead
    // of half-scrubbing it.
    for (const chain of [
      String.raw`a:href="/search?q=\"jane doe\""nth-child="2";div:nth-child="1"`,
      String.raw`a:href="/path\";b:attr__href="/checkout?token=SUPERSECRET"`,
      String.raw`a:href="/x?a=1\";customer=Novakova";div:nth-child="1"`,
    ]) {
      expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(
        "[Filtered]",
      );
    }
  });

  it("scrubs the real href when an element's text ends in a planted `href=`", () => {
    // ADR 1018 defect 1. posthog-js folds the clicked element's `text` into the
    // chain and sorts attributes with localeCompare, which puts `text` last —
    // immediately before the ancestor's attr__href. The old rule inferred the
    // match START from the literal bytes `href="`, so this label opened a bogus
    // match whose closing group was the REAL href's opening quote; lastIndex
    // landed past it and the token shipped. Repro page:
    //   <a href="/invite/accept?token=SUPERSECRET"><span>Paste the value after href=</span></a>
    // `text` sorts LAST, so the label's trailing `href=` is followed immediately
    // by the delimiter that the old rule consumed as its own closing quote — the
    // very quote that opens the real href.
    const scrubbed = sanitizeAnalyticsProperties({
      $elements_chain:
        'span:nth-child="1"text="Paste the value after href=";a:attr__href="/invite/accept?token=SUPERSECRET"nth-child="2"',
    }).$elements_chain;
    expect(scrubbed).not.toContain("SUPERSECRET");
    expect(scrubbed).toBe(
      'span:nth-child="1"text="Paste the value after href=";a:attr__href="/invite/accept"nth-child="2"',
    );
  });

  it("does not read a non-href attribute name ending in `href=` as an href", () => {
    // The name tail requires a non-name character before the (optional) `attr__`
    // prefix, so `data-xhref` is a different attribute and keeps its value.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'div:attr__data-xhref="/x?q=1"nth-child="1"',
      }),
    ).toEqual({ $elements_chain: 'div:attr__data-xhref="/x?q=1"nth-child="1"' });
  });

  it("keeps an ambiguous chain intact when it contains no href at all", () => {
    // ADR 1018 defect 2 (over-redaction). The drop is gated on the chain
    // actually containing an href, so `[Filtered]` no longer destroys the whole
    // element tree here. Most autocapture events are clicks on buttons and divs
    // with no href, and one straight double quote in a Czech UI label is enough
    // to make the chain ambiguous. NB since ADR 1022 the keep is no longer a
    // free trade — a non-href segment could carry an embedded URL query that
    // this branch now forgoes — but the residue is bounded to that one class,
    // against losing the entire tree. This chain carries no URL, so nothing is
    // forgone in THIS case; see the `attr__src` variant below for one that does.
    const chain = String.raw`button:attr__aria-label="Smazat \"Faktura 42\""nth-child="3";div:nth-child="1"`;
    // ADR 1030 §6.1 — an ambiguous escape now redacts UNCONDITIONALLY. The old
    // rule kept an href-less chain on the argument that its residue was bounded;
    // ADR 1022 made that argument false by adding the non-href value pass, and
    // the code was never changed with it. Deleted rather than repaired.
    expect(sanitizeAnalyticsProperties({ $elements_chain: chain })).toEqual({
      $elements_chain: REDACTED,
    });
  });

  it("strips a scheme-less relative href under a URL key (no url-shape gate)", () => {
    // A URL-named key means the value IS a URL — including forms no shape test
    // recognises. A derived app's hand-written anchor emits exactly these.
    expect(
      sanitizeAnalyticsProperties({ attr__href: "?search=Novakova", href: "products?q=shoes" }),
    ).toEqual({ attr__href: "/", href: "/products" });
  });

  // PERIMETRA-LOCAL, and the reason it is worth keeping across a design
  // replacement: both cases below carry a BARE, un-prefixed `href="…"` inside
  // the chain. That is not an exotic shape — it is what the producer emits on
  // every autocaptured anchor click. Measured in the installed bundle
  // (`posthog-js@1.379.2`, `dist/module.js`), the chain serializer builds its
  // attribute map as
  //   {"nth-child":…,"nth-of-type":…}, t.href?{href:t.href}:{}, t.attr_id?…, t.attributes
  // so `href` is a first-class member emitted WITHOUT the prefix, and only
  // `t.attributes` is `attr__`-namespaced.
  //
  // Every other surviving chain assertion in this file uses `attr__href` (or
  // `attr__xlink:href`); the only bare-`href` chains left are inside the
  // `\"`-ambiguous corpus, which is asserted to redact wholesale. So without
  // these two, the NAME-EXTRACTION seam in `scrubElementsChain`
  // (`CHAIN_ATTRIBUTE_NAME_TAIL` → the `attribute !== undefined` ternary) has no
  // regression guard at all: a plausible edit narrowing that extraction to
  // `attr__`-prefixed names leaves the whole committed telemetry suite green
  // while a chain ships `href="/clients?search=Novakova"` verbatim. Verified by
  // executing exactly that mutant: 178/178 still passed, and the surname
  // round-tripped. The scalar path (`{ href: "products?q=shoes" }` above) does
  // NOT cover it — it never reaches the chain's extraction seam.
  //
  // These two were dropped when the W13 drain took this file wholesale from
  // `skeleton/main` (ADR 1030 replaces the design, so a hunk merge was not
  // viable) and are restored unchanged: they pass against the new
  // implementation with no expectation edits.
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

  it("carries the property key into an ARRAY of URL strings", () => {
    // The array branch used to pass "" as the key, which disarmed every
    // key-gated branch for an array of strings. A relative href has no `://` and
    // no dotted `//host`, so the generic embedded-URL pass cannot see it — it
    // kept its query while the identical scalar was stripped. Nothing else
    // catches it: this sink runs no value-shape pass, and the Sentry walk's
    // URL key list deliberately excludes these names.
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
    // Pins the CORRECTED claim (ADR 1019/1012). The comment used to say a
    // malformed or odd-quote-count chain "round-trips unchanged"; it does not.
    // With one quote, split yields two segments, the loop still visits index 1,
    // and the unterminated tail goes through `safeUrlOrRedact`. That behaviour is
    // right — the no-`\"` precondition means a REAL delimiter opened the segment,
    // so it is a truncated href value and scrubbing it is the intended
    // over-redaction (posthog-js truncating a long chain mid-value is the
    // realistic producer). Only the sentence was wrong.
    expect(
      sanitizeAnalyticsProperties({ $elements_chain: 'a:attr__href="/p?q=1' }).$elements_chain,
    ).toBe('a:attr__href="/p');
    // What the narrow claim DOES promise: nothing outside an identified href
    // value is altered. Structure-only and href-less chains are byte-preserved.
    for (const chain of ['div:nth-child="1', 'div:nth-child="1"text="no href here']) {
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
    // ACCEPTED COST: a framework binding expression that survives into the DOM
    // is truncated at its TERNARY `?`. Over-redaction of autocapture detail,
    // never a leak. Narrowing the class to exclude `:` would drop xlink:href
    // coverage — the wrong trade for this module.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'a:attr__x-bind:href="isAdmin ? adminUrl : userUrl"nth-child="1"',
      }).$elements_chain,
    ).toBe('a:attr__x-bind:href="[Filtered]"nth-child="1"');
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
    expect(
      sanitizeAnalyticsProperties({ $elements_chain: 'a:attr__href="/p?q=1' }).$elements_chain,
    ).toBe('a:attr__href="/p');
    for (const chain of ['div:nth-child="1', 'div:nth-child="1"text="no href here']) {
      expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(chain);
    }
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
    // tokenization lowercases attribute names unconditionally. It IS reachable
    // via setAttribute on an SVG-namespace element and via XHTML, and posthog-js
    // keys the chain off the raw attribute name. An ambiguous chain carrying an
    // uppercase HREF must still be dropped, not passed through.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: String.raw`a:attr__HREF="/x?a=1\";customer=Novakova"`,
      }).$elements_chain,
    ).toBe("[Filtered]");
  });

  // ADR 1022 — non-href value segments of the chain. posthog-js serializes EVERY
  // attribute of a non-sensitive element and folds the clicked element's text in
  // too, so the chain carries URLs under names the href rule does not match.
  // Before this branch existed the chain was the one property where those
  // queries survived while the byte-identical value under `$elements` /
  // `$el_text` was stripped in the same call.
  it("strips an absolute URL's query out of a non-href attribute value", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'img:attr__src="https://app.cz/avatar?email=jan@example.cz"nth-child="1"',
      }).$elements_chain,
    ).toBe('img:attr__src="https://app.cz/avatar"nth-child="1"');
  });

  it("strips an absolute URL's query out of the folded-in element text", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'button:nth-child="1"text="Kopirovat https://app.cz/p/x?token=SECRETTOK"',
      }).$elements_chain,
    ).toBe('button:nth-child="1"text="Kopirovat https://app.cz/p/x"');
  });

  it("leaves a bare '?' in ordinary label text alone (the URL primitive is key-gated)", () => {
    // The generic pass needs a `://` or a dotted `//host`, which is exactly why
    // it is used here instead of `safeUrlOrRedact`: a confirmation label must not
    // be truncated at its question mark.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'button:nth-child="1"text="Smazat klienta?"',
      }).$elements_chain,
    ).toBe('button:nth-child="1"text="Smazat klienta?"');
  });

  it("keeps the chain byte-aligned — structure segments are never rewritten", () => {
    const scrubbed = sanitizeAnalyticsProperties({
      $elements_chain:
        'img:attr__src="https://a.cz/x?q=1"nth-child="2";a:attr__href="/clients?search=Novakova"nth-child="1"',
    }).$elements_chain as string;
    expect(scrubbed).toBe(
      'img:attr__src="https://a.cz/x"nth-child="2";a:attr__href="/clients"nth-child="1"',
    );
    // The rejoin is only sound if the quote count is preserved: the generic pass
    // deletes characters and can never introduce a delimiter.
    expect(scrubbed.split('"')).toHaveLength(9);
  });

  // ADR 1024 — the parity guard checks EVERY even segment, including the last.
  it("rejects a chain whose shifted split parks the href value in the LAST segment", () => {
    // The bounded loop (`i < parts.length - 1`) exempted the final even segment
    // as "trailing text". That is exactly where a split shifted by one bare quote
    // parks the href VALUE: only 'x=' was ever checked, it ends in `=`, and the
    // URL at index 2 was read as structure and returned untouched — the chain
    // came back BYTE-IDENTICAL with the token intact. Now `[Filtered]`.
    const chain = 'x="y:attr__href="https://app.cz/p?token=SECRETTOK';
    expect(chain).not.toContain(String.raw`\"`);
    expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(
      "[Filtered]",
    );
  });

  it("still accepts a well-formed chain, whose last even segment is empty", () => {
    const chain = 'a:attr__href="/clients?search=Novakova"nth-child="1"';
    expect(chain.split('"').at(-1)).toBe("");
    expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(
      'a:attr__href="/clients"nth-child="1"',
    );
  });

  it("does not run the generic pass on a chain whose parity is unverifiable", () => {
    // The interaction between ADR 1020 and ADR 1022, which anyora's copy cannot
    // state because it has no parity check: the generic pass is only sound while
    // an odd segment IS the value's exact extent, so it must not run once the
    // grammar check has proved the split slipped. An injected tag_name quote
    // makes `attr__src`'s URL land on an even index; the chain carries no href,
    // so the ambiguous-case policy KEEPS it whole rather than rewriting the
    // wrong segments. This is also the case that makes the keep-branch's residue
    // concrete: the email query IS forgone here, which is the bounded cost ADR
    // 1022 accepts rather than destroying the tree on an unparseable chain.
    const chain = 'img"x:attr__src="https://a.cz/avatar?email=jan@example.cz"nth-child="1"';
    expect(chain).not.toContain(String.raw`\"`);
    // This assertion is INVERTED from the version this replaces, and the old one
    // is the sharpest instance of the trap the finding names: it pinned — as
    // correct, in a green suite — a chain shipping an email inside a query.
    // A parity slip now redacts the chain regardless of whether it carries an
    // href, so the suite can no longer certify the leak.
    expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(REDACTED);
  });

  // ADR 1023 — `$heatmap_data`, the one property whose object KEYS are URLs.
  it("drops the query from $heatmap_data's URL keys", () => {
    expect(
      sanitizeAnalyticsProperties({
        $heatmap_data: { "https://app.cz/clients?search=Novakova": [{ x: 1, y: 2 }] },
      }).$heatmap_data,
    ).toEqual({ "https://app.cz/clients": [{ x: 1, y: 2 }] });
  });

  it("merges $heatmap_data buckets that collapse onto the same path", () => {
    // Overwriting instead of merging would silently make a redaction rule a
    // data-loss rule: `Object.fromEntries` keeps only the last repeated key.
    expect(
      sanitizeAnalyticsProperties({
        $heatmap_data: {
          "https://app.cz/clients?search=Novakova": [{ x: 1, y: 2 }],
          "https://app.cz/clients?search=Svoboda": [{ x: 3, y: 4 }],
          "https://app.cz/recipes": [{ x: 5, y: 6 }],
        },
      }).$heatmap_data,
    ).toEqual({
      "https://app.cz/clients": [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      "https://app.cz/recipes": [{ x: 5, y: 6 }],
    });
  });

  // ADR 1025 — the merge must not be built by assignment into an object literal.
  // WHAT ACTUALLY CLOSES THE `__proto__` HAZARD, stated precisely because the
  // earlier version of this test did not. It was titled as a pin on the `Map`
  // accumulator (an object literal's `merged[k] = v` is a [[Set]], so a key of
  // `__proto__` hits `Object.prototype`'s setter and sets the RESULT'S PROTOTYPE
  // instead of defining an own property, silently dropping the bucket). It did
  // not pin that at all: swapping the `Map` for an object literal left the suite
  // GREEN. The reason is this ADR's own design — every merge key goes through
  // `safeUrlOrRedact` FIRST, which rebuilds it from parser fields, so a bare
  // `__proto__` is normalised to `/__proto__` before it is ever used as a key and
  // the [[Set]] hazard is structurally unreachable. Executed against the
  // primitive: NO input yields the bare key `__proto__`.
  //
  // So this pins the NORMALISATION, which is load-bearing, rather than the `Map`,
  // which is now defence-in-depth (retained deliberately: it is what would still
  // hold if a future change routed an un-normalised key into this merge).
  // The merge itself is pinned by the test above — disarming it to a plain
  // overwrite REDs.
  it("normalises a `__proto__` heatmap key through the parser, so the bucket survives", () => {
    const out = sanitizeAnalyticsProperties({
      $heatmap_data: JSON.parse('{"__proto__":[{"x":1}],"https://a.cz/b?q=1":[{"x":2}]}'),
    }).$heatmap_data as Record<string, unknown>;
    // The key is parser-built, never the raw input byte-for-byte.
    expect(Object.keys(out).sort()).toEqual(["/__proto__", "https://a.cz/b"]);
    // The bucket is an OWN property and the prototype is untouched — the outcome
    // the [[Set]] hazard would have destroyed.
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(out, "/__proto__")?.value).toEqual([{ x: 1 }]);
    // And the hazard's precondition is gone: no key reaching the accumulator is
    // the bare `__proto__`. This is the assertion the old title implied.
    expect(Object.keys(out)).not.toContain("__proto__");
  });

  // ADR 1025 recorded a residue: deleting to end-of-segment could leave a value
  // ending in a backslash that the query had previously separated from the
  // delimiter, so the rejoin EMITTED a `\"` the input did not contain. That
  // residue is closed by construction, not by a rule — a URL-bearing value is
  // now re-serialized from parser fields, and `protocol + "//" + host + pathname`
  // cannot end in a stray backslash.
  it('no longer emits a `\\"` the input did not contain — the answer is parser-built', () => {
    const out = sanitizeAnalyticsProperties({
      $elements_chain: 'img:attr__src="https://a.cz/x\\?q=1"nth-child="1"',
    }).$elements_chain as string;
    expect(out).not.toContain(String.raw`\"`);
    expect(out).toBe('img:attr__src="https://a.cz/x/"nth-child="1"');
    // Idempotent: re-scrubbing our own output is a no-op.
    expect(sanitizeAnalyticsProperties({ $elements_chain: out }).$elements_chain).toBe(out);
  });

  // ── ADR 1030 acceptance corpus ──────────────────────────────────────────
  // Each of these is a defect the previous design shipped, and each must be
  // covered BY CONSTRUCTION rather than by an entry someone remembered to add.

  it("covers the $session_entry_ family by inverting the producer's transform", () => {
    // posthog-js mints these at runtime: `"$session_entry_" + key.replace(/^\$/, "")`,
    // with `$current_url` renamed to `url` first. Round 6 missed them because the
    // vocabulary was a list, and a list cannot be complete against that.
    expect(
      sanitizeAnalyticsProperties({
        $session_entry_url: "https://app.cz/clients?search=Novakova",
        $session_entry_referrer: "https://ext.cz/p?rc=8001011234",
        // NOT a URL — its source key is not one either, so it must survive
        // intact rather than being mangled into "/google".
        $session_entry_utm_source: "google",
        $session_entry_pathname: "/clients?search=Novakova",
      }),
    ).toEqual({
      $session_entry_url: "https://app.cz/clients",
      $session_entry_referrer: "https://ext.cz/p",
      $session_entry_utm_source: "google",
      $session_entry_pathname: "/clients",
    });
  });

  it("covers a session-entry member that does not exist yet, without being told", () => {
    // The whole claim of the transform. If this ever fails, the vocabulary has
    // silently gone back to being an enumeration.
    expect(
      sanitizeAnalyticsProperties({
        $session_entry_external_click_url: "https://x.cz/a?rc=8001011234",
      }).$session_entry_external_click_url,
    ).toBe("https://x.cz/a");
  });

  it("REDACTS the chain when a STRUCTURE segment carries a URL payload", () => {
    // The odd-index-only defect at its root. A Tailwind arbitrary value lands in
    // a class name, which the producer quote-STRIPS rather than escapes, so
    // there is no delimiter to bound a rewrite against that an author cannot
    // plant. The chain goes rather than being half-scrubbed.
    const chain = 'div.bg-[url(https://cdn.app.cz/i?sig=8001011234)]:nth-child="1"';
    expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(REDACTED);
  });

  it("does NOT redact a chain for Tailwind container-query class names", () => {
    // The other direction of the same narrowing: `@` is not a payload marker,
    // because `@md:` and `@container` are ordinary Tailwind v4 class names and
    // userinfo is unreachable without an authority, which `//` already catches.
    const chain = 'div.@container.@md:flex:nth-child="1"';
    expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(chain);
  });

  it("REDACTS a list-valued attribute value inside the chain", () => {
    // The round-6 critical, at the chain sink rather than the scalar one — the
    // leak survived a symmetry matrix that already enumerated `attr__srcset`,
    // because every payload in that matrix was a scalar URL.
    const chain = 'img:attr__srcset="/a.png,//novakova:8001011234@evil.cz/x"nth-child="1"';
    const out = sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain as string;
    expect(out).toBe('img:attr__srcset="[Filtered]"nth-child="1"');
    expect(out).not.toContain("8001011234");
    expect(out).not.toContain("evil.cz");
  });

  it("scrubs attr__src identically to href — one vocabulary, not two", () => {
    // Round 5 shipped `attr__xlink:href` on one path and scrubbed it on the
    // other. The assertion that matters is not that the two paths AGREE — a
    // symmetry assertion passes when both leak — it is that NO payload marker
    // survives on either.
    for (const name of ["attr__href", "attr__src", "attr__xlink:href", "href"]) {
      const chain = `a:${name}="https://app.cz/p?rc=8001011234"nth-child="1"`;
      const out = sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain as string;
      expect(out, name).not.toContain("8001011234");
      expect(out, name).not.toContain("?");
      const scalar = sanitizeAnalyticsProperties({ [name]: "https://app.cz/p?rc=8001011234" })[
        name
      ] as string;
      expect(scalar, name).not.toContain("8001011234");
    }
  });

  it("REDACTS a non-hierarchical scheme under any URL-bearing name", () => {
    expect(
      sanitizeAnalyticsProperties({
        attr__href: "mailto:novakova@example.cz?subject=8001011234",
        $current_url: "data:text/csv;base64,Tm92YWtvdmE=",
      }),
    ).toEqual({ attr__href: REDACTED, $current_url: REDACTED });
  });

  it("cannot emit userinfo from any sink", () => {
    const out = sanitizeAnalyticsProperties({
      $current_url: "https://novakova:8001011234@evil.cz/x?y=1",
      attr__href: "//novakova:8001011234@evil.cz/x",
      $heatmap_data: { "https://novakova:8001011234@evil.cz/p?q=1": [{ x: 1 }] },
    });
    expect(JSON.stringify(out)).not.toContain("8001011234");
    expect(JSON.stringify(out)).not.toContain("novakova");
  });
});

// ── ADR 1031 — the defects the ADR 1030 adversarial review confirmed ─────────
//
// Every case here is a value the previous vocabulary got WRONG, in one of the
// two directions the review found it wrong in: a payload that shipped, or real
// analytics data that was destroyed. Both directions are pinned, because a
// scrubber that over-redacts at scale is a broken scrubber, not a safe one.
describe("sanitizeAnalyticsProperties — ADR 1031 vocabulary and structure repairs", () => {
  // ── The separator class ──────────────────────────────────────────────────

  it("covers HYPHENATED url-bearing attribute names (`data-*` is what HTML looks like)", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements: [
          {
            tag_name: "a",
            "attr__data-href": "/clients?search=Novakova&rc=8001011234",
            "attr__data-url": "/img?owner=Novakova",
            "attr__data-src": "/img?owner=Novakova",
          },
        ],
      }),
    ).toEqual({
      $elements: [
        {
          tag_name: "a",
          "attr__data-href": "/clients",
          "attr__data-url": "/img",
          "attr__data-src": "/img",
        },
      ],
    });
  });

  it("covers the hyphenated names inside the CHAIN too — one vocabulary, both twins", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain:
          'div:attr__data-href="/clients?search=Novakova&rc=8001011234"nth-child="1"',
      }).$elements_chain,
    ).toBe('div:attr__data-href="/clients"nth-child="1"');
  });

  it("covers a camelCase url name, without redacting a word that merely ends in those letters", () => {
    expect(
      sanitizeAnalyticsProperties({
        callbackUrl: "/auth/cb?token=SECRET123",
        redirectUri: "/after?rc=8001011234",
        // `curl` lower-cases to something ending in "url" but is NOT a compound
        // name — the capital is the only boundary there is, which is why the
        // camelCase rule runs BEFORE lower-casing.
        curl: "curl -X POST /api?x=1",
      }),
    ).toEqual({
      callbackUrl: "/auth/cb",
      redirectUri: "/after",
      curl: "curl -X POST /api?x=1",
    });
  });

  // ── Tier 2: ambiguous names are attribute-scoped ─────────────────────────

  it("does NOT mangle ordinary app properties that share an HTML attribute name", () => {
    // The whole point: these are among the most ordinary property names an app
    // can pick. Matching them globally turned a redaction rule into a
    // data-corruption rule.
    expect(
      sanitizeAnalyticsProperties({
        action: "signup_completed",
        data: "user pressed save",
        cite: "Nováková, 2026",
        background: "dark",
        archive: "2026-Q1",
        profile: "admin",
      }),
    ).toEqual({
      action: "signup_completed",
      data: "user pressed save",
      cite: "Nováková, 2026",
      background: "dark",
      archive: "2026-Q1",
      profile: "admin",
    });
  });

  it("STILL covers those names where they really ARE attributes (both twins)", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements: [{ tag_name: "form", action: "/submit?rc=8001011234" }],
        $elements_chain: 'form:attr__action="/submit?rc=8001011234"nth-child="1"',
      }),
    ).toEqual({
      $elements: [{ tag_name: "form", action: "/submit" }],
      $elements_chain: 'form:attr__action="/submit"nth-child="1"',
    });
  });

  it("keeps the unambiguous names global — a bare `href` property is a URL anywhere", () => {
    expect(sanitizeAnalyticsProperties({ href: "/clients?search=Novakova" })).toEqual({
      href: "/clients",
    });
    // `$pathname` is a first-class PostHog property, not only an attribute.
    expect(sanitizeAnalyticsProperties({ $pathname: "/clients?search=Novakova" })).toEqual({
      $pathname: "/clients",
    });
  });

  // ── Tier 3: the bare search term ─────────────────────────────────────────

  it("REDACTS `ph_keyword`, which carries the user's search query out of the referrer", () => {
    // MEASURED in the installed posthog-js: the referring-search-engine helper
    // does `s.ph_keyword = Is(r.referrer, "q")`, lifting the query the user
    // typed into Google. It is not a URL, so the URL vocabulary could not see it.
    expect(
      sanitizeAnalyticsProperties({
        ph_keyword: "Nováková 800101/1234",
        $search_engine: "google",
      }),
    ).toEqual({ ph_keyword: REDACTED, $search_engine: "google" });
  });

  it("carries the REDACT policy through the $session_entry_ inversion", () => {
    // The inversion is a transform, not a list — so a tier-3 source key's policy
    // reaches its session-entry member with nothing added here.
    expect(
      sanitizeAnalyticsProperties({ $session_entry_ph_keyword: "Nováková 800101/1234" }),
    ).toEqual({ $session_entry_ph_keyword: REDACTED });
  });

  // ── The structure-segment marker set, both directions ────────────────────

  it("does NOT destroy the chain for a Tailwind arbitrary HEX COLOUR", () => {
    // The old marker set redacted on any `#`, so a click anywhere on a typical
    // Tailwind page annihilated autocapture — no URL and no PII in sight.
    const chain =
      'button.bg-[#3b82f6].text-white:attr__data-testid="save"nth-child="1";div.mx-auto.max-w-4xl:nth-child="1"';
    expect(sanitizeAnalyticsProperties({ $elements_chain: chain }).$elements_chain).toBe(chain);
    // The 3-, 4- and 8-digit spellings are colours too.
    for (const colour of ["#fff", "#fff8", "#0f172aff"]) {
      const c = `a.bg-[${colour}]:attr__href="/p"nth-child="1"`;
      expect(sanitizeAnalyticsProperties({ $elements_chain: c }).$elements_chain).toBe(c);
    }
  });

  it("STILL redacts the chain for a `#` that is not a hex colour (a fragment payload)", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'div.tab-[#Novakova8001011234]:nth-child="1"',
      }).$elements_chain,
    ).toBe(REDACTED);
    // A hex-looking run that is too long to be a colour is not exempt either.
    expect(
      sanitizeAnalyticsProperties({ $elements_chain: 'div.x-[#0f172aff00]:nth-child="1"' })
        .$elements_chain,
    ).toBe(REDACTED);
  });

  it("REDACTS the chain when a class name carries a NON-HIERARCHICAL scheme payload", () => {
    // None of `//`, `?` or `#` appears in these — the old marker set passed them
    // through byte-identical, re-opening inside the structure half the exact
    // leak the scheme allow-list closed for values.
    for (const cls of [
      "bg-[url(data:text/csv,Novakova;8001011234)]",
      "bg-[url(mailto:jana.novakova@firma.cz)]",
      "bg-[url(tel:+420800123456)]",
    ]) {
      expect(
        sanitizeAnalyticsProperties({ $elements_chain: `div.${cls}:nth-child="1"` })
          .$elements_chain,
      ).toBe(REDACTED);
    }
  });

  // ── style ────────────────────────────────────────────────────────────────

  it("REDACTS an inline style carrying a RELATIVE url(), which no free-text pass can see", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements: [
          {
            tag_name: "button",
            attr__style: "background:url(/avatars/novakova?sig=SECRET123)",
          },
        ],
      }),
    ).toEqual({ $elements: [{ tag_name: "button", attr__style: REDACTED }] });
  });

  it("leaves a url()-free inline style alone", () => {
    expect(
      sanitizeAnalyticsProperties({
        $elements: [{ tag_name: "button", attr__style: "color:red;font-weight:600" }],
      }),
    ).toEqual({ $elements: [{ tag_name: "button", attr__style: "color:red;font-weight:600" }] });
  });

  // ── The final-even-segment parity check, pinned on its OWN merits ────────

  it("REDACTS a shifted-parity chain whose payload sits in the trailing structure segment", () => {
    // Deliberately carries NO `//`, `?`, `#` or `url(` — so the structure-payload
    // rule cannot catch it and only the final-even-segment alignment check can.
    // The previous fixture for this was also caught by the payload rule, which
    // meant deleting the alignment check left the suite green.
    expect(
      sanitizeAnalyticsProperties({
        $elements_chain: 'x="y:attr__href="mailto:jana.novakova@firma.cz',
      }).$elements_chain,
    ).toBe(REDACTED);
  });

  // ── `blob:` at the sink it actually leaked from (ADR 1032) ───────────────
  //
  // `$current_url` is set from `location.href`, so a page that navigated to a
  // blob URL ships one on every autocaptured event. These are the same cases as
  // the primitive suite in `./scrub.test`, exercised through the sink, because
  // the reported leak was measured HERE and a rule closed at the primitive but
  // missed at a sink is this module's oldest failure mode (ADR 1031).

  const BLOB_UUID = "2c1f0a3e-1111-4222-8333-444455556666";

  it("keeps the two browser-minted blob shapes", () => {
    expect(
      sanitizeAnalyticsProperties({ $current_url: `blob:https://app.example.com/${BLOB_UUID}` })
        .$current_url,
    ).toBe(`blob:https://app.example.com/${BLOB_UUID}`);
    // The opaque-origin form, which the old arm corrupted to `blob:/null/<uuid>`.
    expect(
      sanitizeAnalyticsProperties({ $current_url: `blob:null/${BLOB_UUID}` }).$current_url,
    ).toBe(`blob:null/${BLOB_UUID}`);
  });

  it("REDACTS author text behind `blob:` — the live leak, at the sink it leaked from", () => {
    expect(
      sanitizeAnalyticsProperties({
        $current_url: "blob:jan.novak@klient.cz",
        $referrer: "blob:null/novakova-8001011234",
        $external_click_url: "blob:file:///etc/Novakova",
      }),
    ).toEqual({
      $current_url: REDACTED,
      $referrer: REDACTED,
      $external_click_url: REDACTED,
    });
  });

  it("REDACTS a blob-wrapped payload reached through an `$elements` href, not only a scalar", () => {
    // The attribute vocabulary routes `attr__href` through the same primitive,
    // so the arm has to hold at the DOM sinks too — that is what makes it a
    // property of the primitive rather than of one key list.
    expect(
      sanitizeAnalyticsProperties({
        $elements: [{ tag_name: "a", attr__href: "blob:null/novakova-8001011234" }],
      }),
    ).toEqual({ $elements: [{ tag_name: "a", attr__href: REDACTED }] });
  });
});

// ── THE GATE-SYMMETRY MATRIX (ADR 1030) ────────────────────────────────────
//
// PostHog attaches BOTH `$elements` (an object per element) and
// `$elements_chain` (the serialized element tree) to the SAME `$autocapture`
// event, built from the SAME DOM. The two representations therefore carry the
// same bytes under the same attribute names, and a rule applied to one and not
// the other does not redact anything — it RELOCATES the leak onto the same wire
// event. That is the failure `./analytics-scrub`'s own header records twice: two
// vocabularies over one DOM, then one vocabulary consulted through two
// independently authored boundaries.
//
// Ported from the round-6 insurance snapshot (`wip/w7-redaction-rounds`) so this
// coverage outlives that branch. It is the artifact that enforces ADR 1030's
// stated discipline, and it is ported in the SAFETY form on purpose:
//
//   AGREEMENT IS A PARITY PROPERTY. IT IS NOT A SAFETY PROPERTY.
//
// A matrix that asserts only that the two paths answer the SAME thing stays
// green whenever both paths leak IDENTICALLY. That is not hypothetical — it is
// how a `srcset` leak survived a matrix that already enumerated `attr__srcset`
// as a key: every payload in that matrix was a scalar single URL, so the
// list-valued shape had no cell to fail in.
//
// So every cell below must assert something a TOTAL PASSTHROUGH of the URL
// policy would violate. Most rows do that by naming the MARKER that must not
// survive; a row that has no such byte pins the exact ANSWER instead. The
// structural `[?#@]` assertion is NOT that guarantee and never was — a payload
// with none of those characters in it satisfies it while leaking whole. See the
// trap note on `PAYLOADS`: this matrix has already been billed for that once.
describe("sanitizeAnalyticsProperties — gate symmetry across $elements and $elements_chain", () => {
  // Every name in the shared vocabulary, in the ONLY form posthog-js produces
  // for the attribute tier (`attr__` + the raw attribute name), plus both forms
  // of the `href` element-field tier.
  const URL_ATTR_KEYS = [
    "href",
    "attr__href",
    "attr__src",
    "attr__srcset",
    "attr__action",
    "attr__formaction",
    "attr__poster",
    "attr__cite",
    "attr__data",
    "attr__ping",
    "attr__background",
    "attr__manifest",
    "attr__longdesc",
    "attr__usemap",
    // The hyphenated `data-*` tier — what HTML attributes actually look like.
    "attr__data-image-url",
    "attr__data-x-src",
    "attr__data-thumb-href",
    // The NAMESPACED / framework-prefixed tier. React emits `attr__xlink:href`
    // for `xlinkHref` and posthog-js serialises it into BOTH representations,
    // but an earlier round's chain boundary admitted it while the scalar
    // boundary did not — and the suite of the day pinned the CHAIN case with no
    // `$elements` counterpart, affirmatively encoding the asymmetry. These names
    // ride the same matrix as every other now, so it cannot be re-encoded.
    "attr__xlink:href",
    "xlink:href",
    "attr__x-bind:href",
    "attr__v-bind:src",
    "attr__:href",
    "attr__svg.href",
  ];

  /**
   * ── THE MARKER-LESS TRAP — READ THIS BEFORE ADDING A ROW ─────────────────
   *
   * `marker` is the byte that must not survive, and naming it is what makes a
   * cell a SAFETY assertion. A row whose marker is `null` names no such byte,
   * so it degrades ITS WHOLE ROW — one cell per key — to the parity assertion
   * alone, and parity is satisfied when both representations leak IDENTICALLY.
   * That is the exact failure this matrix exists to prevent, arriving through
   * the matrix itself.
   *
   * Not a hypothesis. With the URL policy replaced by a total passthrough
   * (`case "url": return value` in `./analytics-scrub`), the two marker-less
   * rows of the ported matrix were the ONLY cells left standing: 46 green out
   * of 414, split exactly 23 + 23 — one per key, on the two rows that had
   * nothing to lose.
   *
   * So the type below REQUIRES a marker-less row to pin `answer`, the exact
   * output the policy must produce, and every cell asserts that `answer`
   * DIFFERS from `value`. That last assertion is the real guard: a benign
   * fixture whose reduced form happens to equal its own input cannot tell
   * reduction from passthrough no matter what is asserted about it, and does
   * not belong in this matrix. Swap the fixture — that is why `benign` carries
   * a default port — or drop the row. Do not keep a cell that cannot fail.
   */
  type Payload =
    | { value: string; marker: string; answer?: string }
    | { value: string; marker: null; answer: string };

  // One representative of every shape the URL policy branches on, EACH CARRYING
  // THE MARKER THAT MUST NOT SURVIVE — or, where there is none, THE ANSWER IT
  // MUST PRODUCE.
  const PAYLOADS: Record<string, Payload> = {
    "opaque data:": {
      value: "data:text/plain,jan.novak@klient.cz-8001011234",
      marker: "8001011234",
    },
    "opaque mailto:": { value: "mailto:jan.novak@klient.cz", marker: "jan.novak" },
    "opaque tel:": { value: "tel:+420601234567", marker: "601234567" },
    "opaque sms: with query": {
      value: "sms:+420601234567?body=rodne-cislo-8001011234",
      marker: "8001011234",
    },
    // `geo:` is not a `SAFE_SCHEMES` member, so the whole value goes. Pinned as
    // the OUTCOME rather than as an absent marker: a coordinate pair IS the
    // payload here, and "the digits are gone" would also be satisfied by an
    // answer that kept a bare `geo:` — the outcome to hold is REDACTION.
    "opaque geo:": { value: "geo:50.0875,14.4213", marker: null, answer: REDACTED },
    "absolute with query": {
      value: "https://app.cz/clients?token=SEKRET&search=Novakova",
      marker: "SEKRET",
    },
    "protocol-relative with userinfo": {
      value: "//novakova:8001011234@cdn.app.cz/report",
      marker: "8001011234",
    },
    "relative with query": { value: "/clients?search=Novakova", marker: "Novakova" },
    // The value that is SUPPOSED to survive — the row that stops this matrix
    // from being satisfiable by a gate which simply redacts everything. "The
    // payload is gone" is therefore the WRONG assertion for it; the right one is
    // that the answer is the REDUCED form. So the fixture is chosen to make
    // reduction VISIBLE: `host` is `hostname[:port]` and the parser drops a
    // default `:443`, so `https://app.cz/o-nas` is reachable only by rebuilding
    // from parser fields. Anything that hands back input bytes — a slice, a
    // passthrough — still wears the `:443` and fails here. (The previous fixture
    // `/o-nas` reduced to itself, which is precisely why its 23 cells could not
    // fail.)
    benign: { value: "https://app.cz:443/o-nas", marker: null, answer: "https://app.cz/o-nas" },

    // THE NON-SCALAR TIER. Everything above is ONE URL — the model six rounds
    // shared and six rounds were defeated by. These are the shapes that model
    // does not describe, and they are the reason the primitive's "not one URL"
    // test looks at separators rather than at what the members are.
    "list-valued srcset with descriptors": {
      value: "https://cdn.app.cz/a.png 1x, data:text/plain;base64,SEKRET 2x",
      marker: "SEKRET",
    },
    "multi-token ping": { value: "https://app.cz/t mailto:novakova@app.cz", marker: "novakova" },
    "comma-separated, no whitespace": {
      value: "/a.png,data:text/plain;base64,SEKRET",
      marker: "SEKRET",
    },
    "tab-separated list": { value: "https://app.cz/t\tdata:text/plain,SEKRET", marker: "SEKRET" },
    "benign leading URL, hostile trailing (whitespace)": {
      value: "/o-nas https://evil.cz/x?token=SEKRET",
      marker: "SEKRET",
    },
    "benign leading URL, hostile trailing (comma)": {
      value: "/o-nas,mailto:novakova@evil.cz",
      marker: "novakova",
    },
    "nested percent-encoded URL": {
      value: "https://app.cz/r?to=https%3A%2F%2Fevil.cz%2Fx%3Ftoken%3DSEKRET",
      marker: "SEKRET",
    },
    "nested raw URL in the path": {
      value: "https://app.cz/r/https://evil.cz/x?token=SEKRET",
      marker: "SEKRET",
    },
    "bare payload, no URL at all": { value: "Novakova 8001011234", marker: "8001011234" },
  };

  /**
   * Run ONE value through BOTH representations of the same DOM element.
   *
   * PATH A is the `$elements` object walk; PATH B is the `$elements_chain`
   * segment walk, and its answer is read back out of the REJOINED chain so the
   * real split/rejoin is exercised rather than a helper's idea of it. The full
   * scrubbed chain comes back too, because a marker relocated out of the value
   * and into a structure segment must be caught as well.
   */
  function bothPaths(key: string, value: string) {
    const viaElements = (
      sanitizeAnalyticsProperties({ $elements: [{ [key]: value }] }).$elements as Record<
        string,
        string
      >[]
    )[0]?.[key];
    const scrubbedChain = sanitizeAnalyticsProperties({
      $elements_chain: `img:${key}="${value}"nth-child="1"`,
    }).$elements_chain as string;
    const viaChain = /^img:[^"]*="([^"]*)"/.exec(scrubbedChain)?.[1];
    return { viaElements, viaChain, scrubbedChain };
  }

  for (const key of URL_ATTR_KEYS) {
    for (const [shape, row] of Object.entries(PAYLOADS)) {
      const payload = row.value;
      it(`${key} × ${shape}`, () => {
        const { viaElements, viaChain, scrubbedChain } = bothPaths(key, payload);

        // AXIS 1 — SAFETY, asserted FIRST because it is the property that
        // matters. The marker must be gone from both answers AND from the whole
        // rejoined chain.
        if (row.marker !== null) {
          expect(viaElements).not.toContain(row.marker);
          expect(viaChain).not.toContain(row.marker);
          expect(scrubbedChain).not.toContain(row.marker);
          expect(viaElements).not.toBe(payload);
        } else {
          // A row with no marker pins the OUTCOME instead — see the trap note on
          // `PAYLOADS`. The first assertion is the one that keeps this cell
          // able to fail at all: a fixture whose required answer is its own
          // input cannot distinguish reduction from passthrough, and this is
          // where such a fixture is caught rather than silently tolerated.
          const { answer } = row;
          expect(answer).not.toBe(payload);
          expect(viaElements).toBe(answer);
          expect(viaChain).toBe(answer);
          expect(scrubbedChain).toBe(`img:${key}="${answer}"nth-child="1"`);
        }

        // AXIS 1b — the STRUCTURAL half of safety. NOT the property that keeps
        // a cell honest: a payload carrying none of these three characters
        // satisfies it while leaking whole, which is why AXIS 1 above has to
        // hold for EVERY row and not merely for most of them.
        // Every safe answer is re-serialized as `protocol + "//" + host +
        // pathname`: `search` and `hash` are never read, and `host` is
        // `hostname[:port]` by definition, so userinfo is never read either. A
        // `?`, `#` or `@` in an answer therefore means a byte was SLICED out of
        // the input instead of rebuilt from parser fields — the exact regression
        // the primitive's design exists to make impossible. (`@` is sound to
        // assert here because no payload in this corpus has a legitimate `@` in
        // a path, so a surviving one is necessarily userinfo.)
        expect(viaElements).not.toMatch(/[?#@]/);
        expect(viaChain).not.toMatch(/[?#@]/);

        // AXIS 2 — PARITY. Safety at one representation is worthless if the
        // twin ships the same bytes on the same event. Goes RED if EITHER gate
        // is narrowed alone.
        expect(viaChain).toBe(viaElements);
      });
    }
  }

  // No safe answer carries a query, fragment or userinfo marker — the same
  // property AXIS 1b asserts structurally, restated with the markers PLANTED in
  // exactly those three positions so a failure names which one leaked. This is
  // the cell a "keep everything before the first `[?#]`" cut would fail, and
  // that cut is what six rounds each certified and each falsified.
  it("no safe answer carries a query / fragment / userinfo marker, on EITHER path", () => {
    const MARKED = [
      "https://app.cz/clients?token=QUERYMARK",
      "https://app.cz/clients#FRAGMARK",
      "https://app.cz/clients?token=QUERYMARK#FRAGMARK",
      "https://novakova:USERMARK@app.cz/clients",
      "https://USERMARK@app.cz/clients?token=QUERYMARK#FRAGMARK",
      "//novakova:USERMARK@cdn.app.cz/report",
      "/clients?search=QUERYMARK",
      "/clients#FRAGMARK",
      "?token=QUERYMARK",
      "#FRAGMARK",
    ];
    for (const key of URL_ATTR_KEYS) {
      for (const value of MARKED) {
        const { viaElements, viaChain, scrubbedChain } = bothPaths(key, value);
        for (const marker of ["QUERYMARK", "FRAGMARK", "USERMARK"]) {
          expect(viaElements).not.toContain(marker);
          expect(viaChain).not.toContain(marker);
          expect(scrubbedChain).not.toContain(marker);
        }
        expect(viaElements).not.toMatch(/[?#@]/);
        expect(viaChain).not.toMatch(/[?#@]/);
        expect(viaChain).toBe(viaElements);
      }
    }
  });

  // The other side of the vocabulary: a name that is NOT url-bearing must be
  // left alone by BOTH paths, so the matrix above cannot be satisfied by a gate
  // that simply matches everything.
  it("leaves a NON-url-bearing attribute untouched on both paths", () => {
    const payload = "data:text/plain,Cena: 100";
    for (const key of ["attr__data-xhref", "attr__myhref", "attr__nosrc"]) {
      const { viaElements, scrubbedChain } = bothPaths(key, payload);
      expect(viaElements).toBe(payload);
      expect(scrubbedChain).toBe(`img:${key}="${payload}"nth-child="1"`);
    }
  });

  // Why the attribute tier REQUIRES the `attr__` prefix on both adapters: a
  // custom event property named `action` or `data` is free text, and the URL
  // primitive decides with the PARSER, which reads ordinary Czech UI copy as an
  // opaque URI. Widening without the prefix would have destroyed it.
  it("does not read an un-prefixed custom property named after an attribute as a URL", () => {
    expect(sanitizeAnalyticsProperties({ action: "Cena: 100", data: "Datum: 1.1.2026" })).toEqual({
      action: "Cena: 100",
      data: "Datum: 1.1.2026",
    });
  });

  // ── THE RECORDED RESIDUAL ────────────────────────────────────────────────
  //
  // NOT a guarantee. This test pins CURRENT behaviour so the residual is a
  // decision with a regression test rather than an undocumented gap, and it is
  // named EXPOSURE so no reader concludes from the redaction around it that
  // these schemes are covered.
  //
  // ADR 1032 ("The `file:` question, decided rather than inherited") measured
  // that SHRINKING `SAFE_SCHEMES` closes one sink and opens two: the set is an
  // allow-list in `safeUrlOrRedact`, but a route-or-return-the-input-RAW gate in
  // `reduceSourceLocation` and a route-or-skip gate in `scrubDescription`. This
  // skeleton ships no Capacitor, no Ionic and no `file:`-served build in any
  // workspace, so the native-build PROVENANCE argument that put the three schemes
  // on the list does not hold HERE at all — and the ADR records them as an OPEN
  // RE-ARGUMENT rather than silently keeping them.
  //
  // If this test starts failing because these values now REDACT, that is the
  // re-argument being settled — it needs its own ADR, not an edited expectation.
  it("EXPOSURE: capacitor:/ionic:/file: are SAFE_SCHEMES, so a PATH payload survives on both paths", () => {
    const CASES: [value: string, kept: string][] = [
      // The path IS the payload — a document filename is exactly where a surname
      // and a rodné číslo live, and nothing here cuts it.
      [
        "file:///storage/emulated/0/Download/Novakova-8001011234.pdf",
        "file:///storage/emulated/0/Download/Novakova-8001011234.pdf",
      ],
      [
        "capacitor://localhost/klienti/Novakova-8001011234",
        "capacitor://localhost/klienti/Novakova-8001011234",
      ],
      // The QUERY is still cut on these schemes — the exposure is the path, and
      // only the path.
      [
        "file:///android_asset/www/index.html?surname=Novakova",
        "file:///android_asset/www/index.html",
      ],
      ["ionic://localhost/klienti?rc=8001011234", "ionic://localhost/klienti"],
    ];
    for (const [value, kept] of CASES) {
      const { viaElements, viaChain, scrubbedChain } = bothPaths("attr__href", value);
      expect(viaElements).toBe(kept);
      // The residual is SYMMETRIC — it is a property of the shared primitive,
      // not of one gate, so retiring it is one edit and not two.
      expect(viaChain).toBe(kept);
      expect(scrubbedChain).toBe(`img:attr__href="${kept}"nth-child="1"`);
    }
    // Stated outright rather than left implicit in the fixtures: these two ARE
    // shipping their payload today.
    expect(bothPaths("attr__href", CASES[0]![0]).viaElements).toContain("8001011234");
    expect(bothPaths("attr__href", CASES[1]![0]).viaElements).toContain("8001011234");
  });
});
