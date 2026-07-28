# ADR 1044 — `filename` is not a reserved word: the source-location exemption becomes an allow-SHAPE

**Status:** Accepted (2026-07-28) — HQ-ruled default, Martin ratify queued
(do-first doctrine). W15 wave. Landed together with the web-native-skeleton twin,
**ADR 1038**. Narrows the exemption created by
[ADR 1031](1031-the-repair-grew-the-allow-list-and-not-its-callers.md); the
policy it enforces is unchanged.

## Context

ADR 1031 moved `filename` and `abs_path` out of `STRUCTURAL_KEYS` and gave them
their own rule, because in a browser stack frame those fields hold the script's
URL — and for an inline or eval'd script that URL is `location.href`, the current
page **with its querystring**. Correct diagnosis, correct remedy for the case it
was looking at. But the rule it wrote was a KEY NAME:

```ts
const SOURCE_LOCATION_KEYS = /^(filename|abs_path)$/;
…
else if (SOURCE_LOCATION_KEYS.test(key) && typeof entry === "string")
  record[key] = reduceSourceLocation(entry);
```

matched **anywhere in an event, at any depth**. That is a claim about what a key
called `filename` cannot contain — the fail-open spelling ADR 1032 named
explicitly ("write it as an allow-shape, never as a claim about what cannot be
there") — and it is false, because `filename` is not a reserved word in a Sentry
envelope. It is the natural key for an upload field.

So a form post carrying `{ filename: "novakova-9007200004.pdf" }` under `extra`,
under `contexts`, or in a breadcrumb's `data` bag had **all** redaction disabled
on it. Not weakened: disabled. `reduceSourceLocation` returns a relative or
unparseable value byte-identical (which is exactly right for `ok.js`), and the
branch bypasses the value-shape pass entirely, so the rodné číslo in that
filename shipped in the clear on the ERROR path, at the skeleton's default
`tracesSampleRate: 0`.

## Decision

Scope the exemption to **where a stack frame actually lives**, structurally.

A frame is an ELEMENT of a `frames` array — `exception.values[].stacktrace
.frames[]`, `threads.values[].stacktrace.frames[]`, and the legacy top-level
`stacktrace.frames[]` all spell it the same way. The walk already carried one
level of parent context for the `request.data` rule; it now carries a small
`WalkContext` instead of a boolean:

```ts
type WalkContext = {
  underRequest?: boolean; // the immediate parent key was `request`
  frame?: boolean; // this OBJECT is an element of a `frames` array
  framesArray?: boolean; // this ARRAY is the value of a `frames` key
};
```

Two hops rather than one, because an array sits between the key and the frame:
descending into a `frames` KEY sets `framesArray`, and the array branch turns
that into `frame` for each element. **That is the array branch's only
propagation, deliberately** — an object nested deeper inside a frame (a frame's
`vars` bag, say) is not itself a frame and must not inherit the exemption, or the
allow-shape widens by recursion, which is the ADR 1032 defect one level down.
Pinned by a test.

Everywhere else, `filename` and `abs_path` are ordinary strings and get the full
walk. The `frames` key pattern is declared in the registry
(`FRAMES_KEY`) beside `REQUEST_KEY`. Unlike the sibling skeleton, this repo homes
the registry and the walk in the same file, so there is no package boundary to
cross — the declaration simply sits next to the rule that consumes it.

## Consequences

- An upload `filename`, a breadcrumb `data.abs_path` and a top-level `filename`
  now redact normally. A genuine frame is unaffected.
- **One existing test asserted the old contract and was changed, not deleted.**
  It read `scrubEvent({ filename: "9007200004.js" })` at the TOP LEVEL of an
  event and asserted the value survived. That fixture is now wrapped in a real
  frame, which is the whole edit — the source-map protection it exists for is
  intact, it was simply being demonstrated in a place a frame never occurs.
- Disarm-verified: removing `at.frame &&` from the branch reds both new cases
  (the outside-a-frame case and the `frames`-array-arming case), 646/648.
  648 green with the fix.
- **The sibling defect is NOT fixed here, and it is the same class.**
  `STRUCTURAL_KEYS` (`module|function|event_id|release|dist|environment|
server_name|platform`) is also a bare key name matched at any depth, and it
  also returns the input unchanged. `module` and `function` are frame-scoped in
  Sentry's schema and could take exactly this `at.frame` arming; the rest are
  top-level event fields and would want a depth-1 scope, which this walk does not
  currently carry. That is a larger change than the one asked for and is boarded
  rather than smuggled in — but it should be read as open, not as considered and
  dismissed.

## Sources

- Sentry event schema: `exception.values[].stacktrace.frames[]`,
  `threads.values[].stacktrace.frames[]`, `stacktrace.frames[]`.
- ADR 1032's own rule about exemption spelling, applied to the rule ADR 1025
  wrote.
- Test runs and the mutation above, this box, 2026-07-28.
