# ADR 1032 — The `blob:` exemption was a fail-open branch: an exemption inside a deny-by-default primitive must be written as an allow-shape

**Status:** Accepted (2026-07-27) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). **Supersedes the `blob:` clause of [ADR 1030](1030-url-bearing-values-are-reduced-by-the-parser-or-redacted.md) §4**; the rest of ADR 1030 stands, and [ADR 1031](1031-the-repair-grew-the-allow-list-and-not-its-callers.md) is untouched. Landed together with the web-native-skeleton twin, **ADR 1026**.

## Context

ADR 1030 built `safeUrlOrRedact` on one claim, stated in the function's own docstring and repeated in the ADR:

> There is no path through this function that returns an unexamined input byte.

Every safe answer is re-serialized from parser fields — `protocol`, `host`, `pathname` — so a query, a fragment and a userinfo cannot survive because they are never read. Everything the design did not model REDACTS.

The `blob:` arm falsified that sentence. ADR 1030 §4 exempted `blob:` from the scheme allow-list and justified the exemption this way:

> **`blob:`** passes through. Its body is `<origin>/<uuid>` minted by `URL.createObjectURL` — browser-generated, never author-controlled text, with no query component to cut. It is exempt from the redact-to-scheme rule because **there is nothing in it to redact**.

The implementation of that exemption was a single recursive line:

```ts
if (absolute.protocol === "blob:") {
  const inner = safeUrlOrRedact(absolute.pathname);
  return inner === REDACTED ? REDACTED : `blob:${inner}`;
}
```

A `blob:` URL is **non-hierarchical**. The WHATWG parser therefore puts its _entire_ body into `pathname` as one opaque string — `new URL("blob:jan.novak@klient.cz").pathname` is `"jan.novak@klient.cz"`, not a path. The recursive call received that body, found no scheme in it, and fell into this same function's **path-relative** branch, which resolves a relative value against the synthetic base and returns `relative.pathname`. So any author-controlled text prefixed with `blob:` came back with a `/` bolted onto it, and shipped.

Measured against `main` before this change, in both skeletons:

```
safeUrlOrRedact("blob:jan.novak@klient.cz")          -> "blob:/jan.novak@klient.cz"
safeUrlOrRedact("blob:null/novakova-8001011234")     -> "blob:/null/novakova-8001011234"
safeUrlOrRedact("blob:file:///etc/Novakova")         -> "blob:file:///etc/Novakova"
safeUrlOrRedact("blob:https://app.example.com/uuid") -> "blob:https://app.example.com/uuid"   (intended)
```

An e-mail address, a surname and a rodné číslo survive. The third is returned byte-identical. This is a live PII leak, and it is reachable from every sink the primitive serves: `$current_url` and `$referrer` (both set from `location.href`, which really is a `blob:` URL after a navigation to one), `$external_click_url`, every `$elements` / `$elements_chain` `href` and `src`, `$heatmap_data` keys, and the Sentry URL keys.

Two further observations sharpen what went wrong.

**The exemption destroyed the one shape its own prose called browser-minted.** `URL.createObjectURL`, called in a document whose origin is opaque — a sandboxed iframe, a `data:` or `file:` document — mints `blob:null/<uuid>` literally. That body does not parse as a URL, so it too went through the path-relative branch and came back **corrupted** as `blob:/null/<uuid>`. The arm existed to preserve browser-minted blobs and mangled the one that needed preserving, while passing through the ones that were typed.

**The failure was in the spelling, not in the judgement.** "There is nothing in here to redact" is a claim about a value's _provenance_, and provenance is not a property the primitive can observe — it only ever sees bytes. Written that way, the branch had to be permissive by construction: it had no shape to check against, so it had to fall back on the generic machinery, and the generic machinery's most permissive branch is the one that catches unrecognised text.

## Decision

**The `blob:` arm is an ALLOW-SHAPE. A `blob:` value is kept only when its body is provably one of the shapes THIS FLEET'S MINTERS produce — enumerated below, never counted — and REDACTED otherwise. Nothing in the arm recurses.**

`blob:` still cannot join `SAFE_SCHEMES` — `protocol + "//" + host + pathname` is void for a non-hierarchical scheme, which is exactly why it needed its own arm in the first place. What changes is that the arm now states the shapes it accepts instead of asserting that its input is harmless.

```ts
if (absolute.protocol === "blob:") {
  const body = absolute.pathname;
  if (BLOB_OPAQUE_ORIGIN_BODY.test(body)) return `blob:${body}`;
  if (BLOB_ORIGINLESS_BODY.test(body)) {
    if (absolute.search === "") return `blob:${body}`;
    const native = BLOB_NATIVE_QUERY.exec(absolute.search);
    if (!native) return REDACTED;
    return `blob:${body}?offset=${native[1]}&size=${native[2]}`;
  }
  const origin = tryParseUrl(body);
  if (!origin) return REDACTED;
  if (!BLOB_ORIGIN_SCHEMES.has(origin.protocol)) return REDACTED;
  if (!BLOB_OBJECT_PATH.test(origin.pathname)) return REDACTED;
  return `blob:${origin.protocol}//${origin.host}${origin.pathname}`;
}
```

Five properties do the work.

### 1. The legitimate bodies are ENUMERATED from the minters this fleet ships, not counted

**This section was itself wrong on first landing, and the correction is the point.** It read: _"Exactly two bodies are legitimate, because exactly two kinds of origin can mint one."_ That is a sentence about the world rather than a predicate over the input — the precise tell this ADR's own closing section names as fail-open prose — and it was FALSE. Both skeletons ship a React Native / Expo `apps/mobile` (`expo` and `react-native`, catalog `expo56`), and that lineage mints an object URL with **no origin at all**.

- **`blob:null/<uuid>`** — the opaque-origin form (W3C File API §11). Matched on an **anchored whole shape**, never on a `null/` prefix. `blob:null/novakova-8001011234` is not a uuid and redacts; `blob:null/<uuid>/Novakova` has a tail and redacts; `blob:null` and `blob:` redact. A prefix check is how the next bypass gets in, which is the same rule `$direct` is matched under (ADR 1030 §4's other exemption, which was already written correctly).
- **`blob:<document-origin>/<uuid>`** — the tuple-origin form (W3C File API §11), reduced through the same rebuild-from-parser-fields rule as every other safe answer. `blob:https://novakova:8001011234@evil.cz/<uuid>` reduces to `blob:https://evil.cz/<uuid>`: property 1 of ADR 1030 now holds _inside_ the blob arm too, rather than being bypassed by it.
- **`blob:<uuid>` and `blob:<uuid>?offset=<int>&size=<int>`** — the ORIGIN-LESS native form. **Two independent minters**, both verified in this repo's installed packages rather than inferred:
  - `react-native@0.85.3`, `Libraries/Blob/URL.js`:

    ```js
    BLOB_URL_PREFIX = constants.BLOB_URI_SCHEME + ":";
    if (typeof constants.BLOB_URI_HOST === "string") {
      BLOB_URL_PREFIX += `//${constants.BLOB_URI_HOST}/`;
    }
    // …
    return `${BLOB_URL_PREFIX}${blob.data.blobId}?offset=${blob.data.offset}&size=${blob.size}`;
    ```

    On iOS, `Libraries/Blob/RCTBlobManager.mm` exports `@"BLOB_URI_SCHEME" : kBlobURIScheme` (`static NSString *const kBlobURIScheme = @"blob";`) beside `@"BLOB_URI_HOST" : [NSNull null]`. `typeof null` is `"object"`, so the host branch never runs and the prefix stays the bare `blob:` — no origin, no `/`. The id is minted by `NSString *blobId = [NSUUID UUID].UUIDString;`, i.e. an **UPPERCASE** v4 uuid.

  - `expo@56`, `src/winter/url.ts`, ships its **own** `URL.createObjectURL` with the identical template, and `src/winter/runtime.native.ts` does `install('URL', () => require('./url').URL)`. On the Expo lineage these skeletons actually ship, that polyfill is the `URL` that wins — so this shape does not even depend on which of the two files is reached.

  Measured against the first landing of this ADR's arm, in both trees:

  ```
  safeUrlOrRedact("blob:2C1F0A3E-1111-4222-8333-444455556666?offset=0&size=1234") -> "[Filtered]"
  ```

  `main` answered `"blob:/2C1F0A3E-1111-4222-8333-444455556666"`, so the wave changed it. The failure is CLOSED — over-redaction, not a leak — but over-redaction is only tolerable while it is RARE, and this is the **primary object-URL shape on the mobile platform both skeletons ship**. §3 below argues the `capacitor:`/`ionic:` entries by naming that platform, while the allow-shape excluded its actual object-URL form: the list grew toward the native build and the shape did not.

All three are matched on an anchored WHOLE shape, never a prefix, and the id alphabet is shared — which is why the `i` flag on all three regexps is a REQUIREMENT rather than laxity: minter (c) emits uppercase.

### 2. The id is matched as a uuid, not as "a path segment"

`BLOB_OBJECT_ID` is `[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`. The version nibble is left open (1–8) rather than pinned to `4`. Every shipping browser mints a v4 id today; a future move to v7 must cost us a redaction we can _see_, in a failing test, rather than the silent redaction of every blob URL in production. Pinning it to `4` optimises for today's browsers and fails invisibly; leaving it RFC-4122-shaped keeps the match exact while surviving a generator change.

Requiring the uuid on the tuple-origin form is a deliberate tightening beyond the reported leak: `blob:https://app.example.com/uuid-1234` and `blob:https://app.example.com/clients/Novakova` now redact, because `createObjectURL` cannot mint either. The cost is a redacted value in a debugging field; the alternative is a blob arm that will keep an arbitrary attacker-chosen path as long as it is prefixed with a real origin.

### 3. The blob inner scheme list is NARROWER than `SAFE_SCHEMES`, on a stated rule

`BLOB_ORIGIN_SCHEMES` is `http:`, `https:`, `capacitor:`, `ionic:` — the schemes a **document** can be served from, which is what a blob's tuple origin is.

- **`file:` is excluded.** A `file:` document has an _opaque_ origin, so `createObjectURL` in one mints form (a), `blob:null/<uuid>`. A `blob:file:…` is therefore proof the value was typed rather than minted, and `blob:file:///etc/Novakova` — which `main` returned byte-identical — redacts.
- **`ws:`/`wss:` are excluded.** No document is ever served over them.
- **`capacitor:`/`ionic:` ride along with their `SAFE_SCHEMES` membership.** They are real page origins on the native build, so a blob minted on one is exactly as legitimate as the page that minted it.

This is the sub-decision that most needs stating: the arm does **not** reuse `SAFE_SCHEMES`. Reusing it would have been the natural, tidy-looking choice, and it is what keeps `blob:file:` alive.

### 4. The path-relative branch is unreachable from the blob arm

That reachability _was_ the defect, so the arm calls `tryParseUrl` (absolute, no base) directly instead of recursing. A nested `blob:blob:https://…` also redacts, because the inner protocol is `blob:` and `blob:` is not a document-origin scheme — no recursion, no nesting, no second entry into the primitive.

### 5. The one query this module accepts is a SHAPE, and it re-opens nothing

Form (c) is the only place in `scrub.ts` where `search` is read at all. ADR 1030's property 1 rests on "`search` and `hash` are never read", so accepting a query here needs an argument, not an assurance — and "the values are platform-generated integers, not author text" is a provenance claim, which is exactly the spelling this ADR exists to reject. The argument has to be about the bytes:

- **It is matched against the WHOLE `search` field**, `/^\?offset=(\d+)&size=(\d+)$/`. Not a prefix, not a param-bag walk, not "the blob arm may carry a query". Both params, in the minted order, values non-negative integers, nothing before, between or after them.
- **`search` is a parser field, not a slice of the input.** The parser has already terminated it at the fragment and already decided where the query begins, so a `#…` tail cannot be inside it and a smuggled second `?` lands _inside_ the field and fails the anchor: `?offset=0&size=1?offset=0&size=1` redacts.
- **The answer is re-serialized from the two capture groups.** The punctuation in the output is this module's own literal; the only author-controlled bytes that can reach a sink through this branch are `[0-9]`. That is the same rule every other safe answer in the primitive obeys, applied to a query for the first time.
- **The residual channel is therefore exactly two integer runs — and it is not the last line.** `redactString` runs downstream of the primitive at every sink, so a rodné-číslo-shaped run parked in the integer slot still dies: `safeUrlOrRedact` answers `blob:<uuid>?offset=8001011234&size=1` and the sink ships `blob:<uuid>?offset=[Filtered]&size=1`. Both halves are pinned by a test.

The pair is **optional**, because it is metadata and not identity: a caller that logged `url.split("?")[0]` hands the primitive the bare body, which is the same minted value. A fragment appended to either spelling is destroyed rather than carried — `hash` is still read nowhere — so `blob:<uuid>#rc=8001011234` answers `blob:<uuid>`.

Every rejection above is pinned by a table-driven test, and the existing "no safe answer carries a `?`, `#` or `@`" loop gained four origin-less hostile members so the widening cannot quietly become a general query exemption.

### The Android object-URL form, declined with a reason

A reviewer raised `blob:content://<authority>/<uuid>?offset=&size=` as the same platform's other shape. Two things are true and neither makes it a fourth form here.

RN does not mint that string. `ReactAndroid/…/modules/blob/BlobModule.kt` returns

```kotlin
mapOf("BLOB_URI_SCHEME" to "content", "BLOB_URI_HOST" to resources.getString(resourceId))
```

so `BLOB_URL_PREFIX` becomes `content://<authority>/` and Android mints `content://<authority>/<uuid>?offset=&size=` — a `content:` URL that never reaches the blob arm at all. (If `blob_provider_authority` is not declared the map is empty, `createObjectURL` throws, and there is no URL to scrub.)

Both spellings redact, and both redacted on `main` too — pre-existing, not a regression:

```
safeUrlOrRedact("content://your.app.package.blobs/<uuid>?offset=0&size=1234")      -> "[Filtered]"
safeUrlOrRedact("blob:content://your.app.package.blobs/<uuid>?offset=0&size=1234") -> "[Filtered]"
```

**Declined deliberately.** Modelling it means putting `content:` on a scheme list and accepting an app-declared authority as a host — an unbounded string this module cannot prove anything about, for a value that is currently safe. If Android object URLs ever need to survive telemetry, that is a `SAFE_SCHEMES` decision with the three-polarity problem below attached to it, not a widening of the blob allow-shape. Both spellings are pinned by a test so the decline is visible rather than an omission.

## The `file:` question, decided rather than inherited

ADR 1030 §3 put `capacitor:`, `ionic:` and `file:` on `SAFE_SCHEMES` "on PROVENANCE — the web-native lineage's native build really does serve pages from those origins". This skeleton has no Capacitor or Ionic dependency, in any workspace, so the stated provenance argument does not hold _here_, and `file:///Users/x/rodne-cislo.pdf` currently returns whole. The obvious conclusion is to drop the schemes this repo cannot produce.

**That conclusion is wrong, and measurement is what shows it.** `SAFE_SCHEMES` is read with **three different polarities** in this module:

| Reader                 | What membership means               | What removal does              |
| ---------------------- | ----------------------------------- | ------------------------------ |
| `safeUrlOrRedact`      | allow-list — reduce it, else REDACT | starts redacting — safer       |
| `reduceSourceLocation` | route-or-**return the input RAW**   | starts passing through — worse |
| `scrubDescription`     | route-or-**skip the primitive**     | starts passing through — worse |

Compiled both variants of `scrub.ts` and ran them side by side:

```
"file:///var/app/index.html?token=abc"
  reduceSourceLocation  keep file: -> "file:///var/app/index.html"
  reduceSourceLocation  drop file: -> "file:///var/app/index.html?token=abc"
"file:///android_asset/www/index.html?surname=Novakova"
  scrubDescription      keep file: -> "file:///android_asset/www/index.html"
  scrubDescription      drop file: -> "file:///android_asset/www/index.html?surname=Novakova"
  safeUrlOrRedact       keep file: -> "file:///android_asset/www/index.html"
  safeUrlOrRedact       drop file: -> "[Filtered]"
"file:///Users/novakova/Documents/rodne-cislo-8001011234.pdf"
  reduceSourceLocation  keep file: -> unchanged
  reduceSourceLocation  drop file: -> unchanged
```

**Shrinking `SAFE_SCHEMES` closes one sink and opens two.** It also does not fix the value the question was asked about: `file:///Users/novakova/…/rodne-cislo-8001011234.pdf` survives whole in _both_ variants, because `reduceSourceLocation`'s else-branch returns it either way.

So: **`file:` stays, and the residual exposure is recorded as an exposure rather than defended as a design.** For `file:` the path _is_ the payload, and a document filename is precisely where a surname and a rodné číslo live. That exposure is real; it is pinned by a test named as such, so it cannot be rediscovered as a surprise. The repair for it is a redact-to-scheme rule for path-is-payload schemes, and it must be preceded by fixing the two inverted-polarity callers — a different change, to a different set of files, with its own blast radius. Bundling it into this slice would have been the ADR-1031 mistake in reverse: the allow-list shrinks and its callers do not.

`capacitor:` and `ionic:` are separately unproven — neither skeleton ships either framework — but they are also not _leaking_, and removing them collides with the same three-polarity problem. Recorded as an open re-argument, not silently kept.

## Consequences

- **Behaviour that changes.** `blob:` values that are not one of the three minted shapes now REDACT instead of shipping with a `/` prefix. `blob:null/<uuid>` is preserved instead of being corrupted. `blob:<uuid>` and `blob:<uuid>?offset=<int>&size=<int>` — the origin-less native form — are preserved instead of being corrupted to `blob:/<uuid>` (`main`) or redacted (this ADR's first landing). `blob:file:…`, `blob:ftp:…`, `blob:ws:…` and nested `blob:blob:…` redact. A tuple-origin blob whose path is not a uuid redacts, which is stricter than ADR 1030's pinned `blob:https://app.example.com/uuid-1234`.
- **The docstring claim is true again, and it had to be amended to stay true.** Every branch of the arm either returns a value re-serialized from parser fields, or a value that has passed an anchored whole-shape match against a fixed alphabet (41 characters of `null/` + hex for form (a), 36 for form (c)) — plus, on form (c) alone, at most two digit runs taken from capture groups of an anchored whole-field match. The docstring's "`search` and `hash` are never read" is now stated exactly: `hash` is read nowhere; `search` is read at one place, under an anchored whole-field shape.
- **The two trees are byte-identical here.** The URL-primitive region of `packages/telemetry/src/scrub.ts` and of web-native's `packages/utils/src/pii.ts` were compiled with esbuild's `transform()` API — comments stripped, output asserted non-empty first, because the esbuild CLI on a file argument can emit nothing silently — and diffed: 47 lines / 1969 bytes each, zero differing lines. The same 14-input behavioural matrix was run through both compiled modules and diffed: identical on every case.
- **Guards.** Sixteen new cases across `packages/telemetry/src/scrub.test.ts` and `packages/telemetry/src/analytics-scrub.test.ts`, plus four more hostile values on the existing "no safe answer carries a `?`, `#` or `@`" loop (six blob members in total). **Nine assertions were run red against the unfixed arm and green after it** — eight of the original cases plus that loop, which the old arm failed on `blob:jan.novak@klient.cz` by answering `blob:/jan.novak@klient.cz`. Three of the original cases (the tuple-origin keep, the userinfo strip inside a blob body, and the `file:` exposure pin) were green before and after: fences on behaviour this change had to preserve, labelled as such rather than counted as guards.
- **The form-(c) correction was disarmed three ways**, each reverted transiently and re-run: deleting the branch turns the two acceptance tests red (`expected '[Filtered]' to be 'blob:2C1F0A3E-…'`); replacing the exact-shape check with `return \`blob:${body}${absolute.search}\`` turns the rejection table red at its first row (`?offset=0: expected 'blob:…?offset=0' to be '[Filtered]'`) **and** the hostile loop red on `blob:<uuid>?search=Novakova`; dropping the `i`flag from`BLOB_ORIGINLESS_BODY` turns the uppercase-id assertion red. The Android decline is a fence (green before and after) and is not counted as a guard.

### What a draining repo must do

- Nothing, if it has not touched `safeUrlOrRedact`. The change is internal to the primitive and every sink inherits it.
- If it **dropped `apps/mobile`** (no React Native, no Expo): form (c) is now unminted in that repo and could be removed. Removal is safety-monotone here — it only ever starts redacting — but it also removes the module's only accepted query, so remove the `search` read with it rather than leaving a live branch with no shape behind it.
- If it **added another object-URL minter** (a WebView bridge, a Capacitor filesystem plugin): enumerate it in the source comment beside the other three and give it its own anchored shape. Do not widen an existing shape to cover it, and do not restate the count — the count is what was wrong here.
- If it **added a scheme** to `SAFE_SCHEMES`: check `BLOB_ORIGIN_SCHEMES` separately. The two lists answer different questions — "may we keep this URL's authority and path" versus "can a document be served from this origin" — and a scheme that is safe to keep is not automatically a scheme a blob can be minted on. Adding to one is not adding to the other.
- If it **removes** a scheme from `SAFE_SCHEMES`: read the three-polarity table above first. Removal is not a safety-monotone operation in this module.
- If it stores `$current_url` values captured before this change, they may contain `blob:/…` payloads. This fix is forward-only; it does not rewrite history in the analytics vendor.

## The generalised lesson

**An exemption inside a deny-by-default primitive is a fail-open branch. Write it as a narrow allow-shape, never as "there is nothing in here to redact."**

The two spellings look equivalent and are not:

- _"There is nothing in here to redact"_ is a claim about where a value came from. The primitive cannot observe provenance — it sees bytes — so the branch has no shape to test and must hand the value to something more permissive. Here it handed it to the function's own most permissive branch, which is why the exemption did not merely fail to help: it actively laundered author text through the path-relative resolver.
- _"This is kept only if it matches this shape"_ is a claim about the bytes in hand. It is checkable, it is anchored, and when the input does not match it, the default is REDACT — which is the whole point of a deny-by-default primitive.

The tell is grammatical, and it is cheap to apply in review: **if a branch's justification is a sentence about the world rather than a predicate over the input, it is fail-open.** ADR 1030 §4's other exemption, `$direct`, was written in the second form ("matched exactly, never as a prefix") and has never leaked. Both were called exemptions; only one was one.

The corollary, which is what makes this worth an ADR rather than a commit message: an exemption that carries a _justification_ rather than a _shape_ will also mangle the very inputs it was written to protect, because it has no way to recognise them either. `blob:null/<uuid>` is the proof — the arm existed to preserve browser-minted blobs and was the only thing in the module that corrupted one.

**And the second-order lesson, which this ADR earned by failing it.** Replacing an exemption with an allow-shape does not by itself make the branch right; it moves the risk from _fail-open_ to _over-redaction_, and over-redaction is only acceptable while it is RARE. The first landing of this arm justified its shape list with a COUNT — "exactly two, because exactly two kinds of origin can mint one" — which is the same grammatical tell one level up: a sentence about the world, standing in for an enumeration of the producers actually in the repo. It cost the primary object-URL shape of the platform the same ADR cited two sections later to justify `capacitor:`/`ionic:`. **An allow-shape must be derived from the MINTERS the tree ships, named and read, not from a count of the kinds someone could think of** — and the enumeration belongs in the source comment, where the next person widening the list will see it.

## Sources

- WHATWG URL Standard §4.4 "URL parsing" — non-special schemes produce an opaque path, which is why `new URL("blob:…").pathname` is the whole body.
- W3C File API §11 "Creating and Revoking Object URLs" — the `blob:` serialization is `"blob:" + origin + "/" + UUID`, with the literal `"null"` when the origin is opaque.
- `react-native@0.85.3` `Libraries/Blob/URL.js` (`createObjectURL`, `BLOB_URL_PREFIX`), `Libraries/Blob/RCTBlobManager.mm` (`kBlobURIScheme`, `BLOB_URI_HOST : [NSNull null]`, `[NSUUID UUID].UUIDString`) and `ReactAndroid/src/main/java/com/facebook/react/modules/blob/BlobModule.kt` (`BLOB_URI_SCHEME to "content"`, `UUID.randomUUID()`), read in this repo's own `node_modules`.
- `expo@56` `src/winter/url.ts` (its own `URL.createObjectURL`) and `src/winter/runtime.native.ts` (`install('URL', …)`), likewise read in this repo's `node_modules` — the polyfill that wins on the shipped Expo lineage.
- ADR 1030 §1–§4 (the primitive, the list-value rule, `SAFE_SCHEMES`, the two exemptions); ADR 1031 (the same class one layer out: a rule closed at the primitive and missed at its callers).
- Measurements in this ADR were produced against `main` (fullstack `a55e8bc`) with the repo's own vitest run and with esbuild `transform()` over the two source files.
