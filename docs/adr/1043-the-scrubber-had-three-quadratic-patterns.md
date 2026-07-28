# ADR 1043 — The scrubber had three quadratic patterns, not one, and every bound is standards-derived

**Status:** Accepted (2026-07-28) — HQ-ruled default, Martin ratify queued
(do-first doctrine). W15 wave. Landed together with the web-native-skeleton twin,
**ADR 1036**. Amends the scrubber owned by
[ADR 1011](1011-client-sentry-url-query-scrub.md) and
[ADR 1030](1030-url-bearing-values-are-reduced-by-the-parser-or-redacted.md).
Changes no policy — only the cost of enforcing it.

**Where the trees diverge, and why.** web-native homes these patterns in a
`@repo/utils` PII registry (its DAG forbids a `telemetry → validators` edge and
the registry is consumed by the logger too); this repo homes them inside
`packages/telemetry/src/scrub.ts`, whose contract is instead pinned against the
`@repo/db` `pii()` registry by `scrub.pii-contract.test.ts`. The patterns and the
bounds below are byte-identical across both; only the file and the export name
(`STRING_PATTERNS` here, `PII_VALUE_PATTERNS` there) differ.

## Context

`redactString` runs **synchronously, on the caller's thread**, inside Sentry's
`beforeSend` and `beforeBreadcrumb`. Its input is arbitrary captured text: an
error message, a request body (`httpServerIntegration` captures up to 10 KB by
default), a breadcrumb, a stringified object. So a quadratic pattern in this
module is not a style question — it is a denial of service reachable from any
string that reaches telemetry.

The brief named the e-mail pattern. Measuring found **three**, all quadratic, all
reachable, and the largest was not the one that was reported. Measured on this
box, node 24.16.0, against the sizes shown:

| pattern                                 | adversarial input      | cost       |
| --------------------------------------- | ---------------------- | ---------- |
| `/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/`     | 128 KB word run + `@`  | **9.0 s**  |
| `/\b[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}\b/` | 128 KB hyphenated run  | **18.5 s** |
| `EMBEDDED_URL_QUERY`                    | 256 KB of `"https://"` | **5.5 s**  |
| `EMBEDDED_PROTOCOL_RELATIVE_URL_QUERY`  | 256 KB of `"//a.b/"`   | **7.2 s**  |

The JWT pattern is worse than the e-mail one and needs no `@`. The two URL passes
need no PII shape at all — they fire on `.includes("://")` / `.includes("//")`,
_before_ the `ANY_VALUE_PATTERN` fast path, so they are the cheapest of the four
to trigger. Fixing only the reported pattern would have left the two worst
sitting behind an unrelated guard, which is this lineage's own recurring failure
("a rule closed at one sink and missed at another") reproduced by the repair.

The two URL passes also have a **different mechanism**, and getting that wrong
matters: their `[^\s?#]*` excludes `?` and `#`, so the backtracking is provably
useless and an atomic-group rewrite looks like the elegant fix. It was measured
and it only **halved** the cost (1.52 s → 0.94 s), because the expense is the
greedy **forward scan**, not the backtrack: on `"https://".repeat(N)` every one
of the N occurrences is a match attempt that scans to the end of the string.
Only a bound fixes that.

## Decision

**Every unbounded quantifier that can scan a captured string carries an explicit
upper bound**, and every bound is derived from a standard so that what falls
outside it is stateable rather than arbitrary.

| pattern              | after                                          | derivation                                                                                                    |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Bearer               | unchanged                                      | the literal `Bearer\s+` anchors it; `=` is outside the class, so no ambiguity. Measured 0.6 ms at 128 KB      |
| JWT                  | `{8,512}.{8,4096}.{4,1024}`                    | header ≈36 chars (≈200 with `kid`/`x5t`); 4096 covers a large claim set; 1024 covers an RS512 signature (683) |
| e-mail               | `{1,64}@(?:[\w-]+\.){1,64}[A-Za-z]{2,24}`      | RFC 5321 local part 64 octets; longest IANA TLD 24; DNS ≤127 labels                                           |
| rodné číslo          | unchanged                                      | already bounded. 0.3 ms at 128 KB                                                                             |
| `EMBEDDED_URL_QUERY` | `[^\s?#]{0,2048}`                              | the de-facto interoperable URL length                                                                         |
| protocol-relative    | labels `{1,63}`, port `{1,5}`, path `{0,2048}` | DNS label limit; port digits; as above                                                                        |

Two of those choices are worth stating explicitly, because the obvious
alternative is worse:

**The e-mail domain is DECOMPOSED into labels rather than capped.** The flat form
`[\w.-]{1,255}` is linear and is what the RFC domain limit suggests — but it
silently stops matching a long single-label domain, so `a@bbb…(300).com` comes
back unredacted. The decomposed form `(?:[\w-]+\.){1,64}` is linear **without**
that cap, because `[\w-]` cannot match the `.` that separates the labels: the
partition is deterministic and there is nothing to backtrack across. Measured
identical worst case (18.7 ms vs 18.1 ms at 128 KB) and strictly more coverage,
so the cap is not taken.

**The first JWT segment bound is the one that costs.** For a string that is one
long `[\w-]` run with no dot, the match dies in segment 1 at every word boundary,
so cost ≈ the first bound × start positions and the other two bounds are free.
512 vs 256 measured 90 ms vs 47 ms; 512 is taken for header headroom, because
90 ms on a 256 KB adversarial string is already two orders of magnitude inside
the budget.

## Consequences

Composite `redactString`, worst case at 128 KB: **18.3 s → 0.11 s**. Linearity
verified by doubling — 9.5 / 19.4 / 39.9 / 78.1 ms at 64 / 128 / 256 / 512 KB.

**The cost is narrower redaction, never absent redaction — except in one stated
place.** A 70-character local part still redacts, just from character 65 onward
(pinned by a test). What genuinely stops matching is a string outside the
standards above, which is not a deliverable address. The one real loss is a URL
whose origin+path exceeds 2048 characters keeping its query in the **free-text**
pass — acceptable only because that pass is explicitly the best-effort half:
anything a KEY identifies as URL-bearing goes through `safeUrlOrRedact`, which is
the URL parser, has no regex and no length limit. This bound narrows the
fallback, never the guarantee.

Pinned by `packages/telemetry/src/scrub.test.ts`, in three ways on purpose:

- **timing**, with a deliberately loose 2 s ceiling — tight numbers turn a slow
  runner into a red gate for no defect, and the pre-fix costs (5–18 s) are two
  orders of magnitude away, because a regression restores the quadratic and not
  a constant factor;
- **coverage**, so the bound cannot be "bought" by matching less: a plain
  address, a subdomained address, a 300-char single-label domain, HS256, RS256,
  RS512 and a 4 KB-payload token all still redact;
- **structurally** — no open-ended `{n,}` survives in `STRING_PATTERNS`.
  A timing assertion tells you the machine was fast, not that the pattern is
  safe. `+`/`*` are deliberately still allowed, because they are safe where a
  literal anchors them; the ban is on the exact form that bit us.

Disarm-verified by reverting each pattern against the landed suite: reverting all four at once reds all
six new assertions — 7.7 s, 7.5 s (e-mail), 18.6 s (JWT), 5.5 s, 7.2 s (the two
URL passes) and the structural one.
618 tests green on the fixed patterns.

**One sizing detail was itself a defect and is recorded in the test:** the two
URL cases were first written at 128 KB, where the pre-fix cost is 1.5 s / 2.2 s —
straddling the 2 s ceiling. They did not red against the defect they exist for.
They run at 256 KB, where quadratic quadruples and linear only doubles.

## Sources

- All timings measured on this box (node 24.16.0, WSL2) 2026-07-28, both as
  standalone `RegExp.test` and through the composite `redactString`.
- The atomic-group experiment (`(?=([^\s?#]*))\2`) measured and rejected in the
  same session: behaviourally identical over a 19-case corpus, 1.52 s → 0.94 s.
- RFC 5321 §4.5.3.1 (local part 64, domain 255), RFC 1035 §2.3.4 (label 63),
  IANA TLD list (longest 24).
