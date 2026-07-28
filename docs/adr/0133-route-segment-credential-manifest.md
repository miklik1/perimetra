# ADR 0133 — Every dynamic route segment is declared credential-bearing or not, deny-by-default

**Status:** Accepted (2026-07-28). The structural companion to
[ADR 0130](0130-share-token-rides-the-url-fragment.md), which fixed the one route that had the
problem; this ADR is about the next one.

## Context

ADR 0130 records why a bearer credential in a URL path segment defeats every telemetry rule this
repo has: the rules reduce a URL by keeping its pathname, which is correct and useful, and silently
assumes the path holds no secret. `/nabidka/[token]` broke that assumption, and nothing in the guard
set could notice — the scrubber was behaving exactly as designed, `SENSITIVE_KEYS` matches key names
rather than positional path values, and the `pii()`-contract test mirrors registered columns, which
a share token correctly is not.

Fixing the one route does not fix the class. **"Reduce the URL to its path" is a safety claim about
the route table, not about the scrubber**, and a route table changes every wave. So a repo that
adopts a path-preserving scrubber owes a standing audit of its own path segments, and that audit
belongs next to the route contract rather than inside the telemetry package.

The obvious guard is a **credential vocabulary**: red when a dynamic segment is named `token`,
`secret`, `key`, `invite` or `reset`. That was the shape originally proposed in the finding note,
and it is the wrong shape. It does not catch the case that is still live in this tree:
`accept-invitation/[invitationId]` carries an emailed unguessable id, and `invitationId` does not
contain `invite`. A vocabulary is a guess about what the next credential will be _called_, and a
route that opts out of the guarantee by being named unimaginatively is precisely the failure the
guard exists to prevent. It also fails in the other direction, reddening on an innocent `[keyId]`
and training people to add exceptions.

## Decision

**Invert the default.** `apps/web/route-credential-manifest.ts` declares every dynamic route segment
under `apps/web/app/`, and a colocated vitest suite walks the directory tree and refuses anything
undeclared. A new route with a new segment fails until somebody writes down what its value is — so
the default for an unconsidered route is **closed**, and the judgement is made once, in review, by
the person who knows.

Each declaration carries the segment, its kind (`dynamic` / `catch-all` / `optional-catch-all`),
whether possession of the URL is itself the authorisation, what actually gates it (`proxy` / `api` /
`token`), and a one-line reason for the next reader.

Four properties, all failing closed:

1. **Completeness** — every discovered segment is declared.
2. **Freshness** — every declaration still exists on disk, so the manifest cannot rot into fiction.
3. **Anti-vacuity** — the walk found segments at all, and a known one is among them. Without this,
   moving or renaming `app/` turns (1) into a loop over an empty list that passes while auditing
   nothing. This mirrors the anti-vacuity assertion in `scrub.pii-contract.test.ts`.
4. **Gate honesty** — a `credential: false` claim is cross-checked against the proxy's own
   `PROTECTED_PREFIXES`, read from source. A route outside that list cannot claim a proxy gate; it
   must declare an api-side gate and name it. `/platform/releases/drafts/[id]` is the live case: no
   proxy prefix, no layout gate, guarded server-side by `PlatformGuard` over an org-scoped store.

Three implementation choices worth recording, because each has an obvious wrong alternative:

- **Keyed by DIRECTORY, and the walker enumerates directories.** `app/orders/[id]` has no `page.tsx`
  of its own — only `production/` children — so a walker keyed on route files silently drops it and
  ships a blind spot that still looks green.
- **Catch-alls are modelled, not normalised away.** `[...path]` yields the segment name `...path`; a
  naive `\[(\w+)\]` matches nothing for it and the catch-all disappears from the inventory.
  Optional catch-alls do not exist in this tree yet and are modelled now, because the first one
  added would otherwise fail open. The optional pattern is tested before the plain one, since
  `[[...x]]` also matches the looser forms.
- **Read off disk, do not import a registry.** `packages/navigation`'s `routes` is deliberately
  partial (sub-routes there use raw hrefs) and carries phantom skeleton entries with no directory at
  all. Checking it against the manifest would be drift measuring drift. The filesystem is the only
  faithful reading of a file layout — the same argument, and the same `node:fs` method, as
  `scrub.pii-contract.test.ts` reading the `pii()` registry off the schema source.

**Home: a vitest suite in `apps/web`, not a standalone `scripts/check-*.mjs` guard.** The ADR 1028/1029
guard family exists because those subjects live outside any workspace, so `turbo run test` cannot
reach them and each needs four separate wirings (package.json, the CI lint job, lefthook pre-push,
`claude-gate.sh`) — with half-wiring the realistic failure. This subject IS a workspace file tree, so
a colocated suite is reached for free by all four, and there is nothing to half-wire.

## Consequences

- Adding a dynamic route now costs one manifest row. That friction is the feature: the row is where
  somebody has to answer "would an attacker who learned only this URL gain access to anything?".
- **This guard redacts nothing.** It is a build-time completeness check, and treating a declared
  credential-bearing route as therefore _safe_ would be the substantive misreading. Closing a leak,
  once declared, is a separate act — for `/nabidka` that act was ADR 0130.
- The manifest is a natural compile source for a future RUNTIME segment redaction, and that is
  deliberately **not** taken here. It would have to live in `packages/utils`, `config` or
  `telemetry` (the ESLint DAG makes `telemetry → navigation` uncompilable), be applied inside
  `safeUrlOrRedact` at both return sites, and be drift-guarded by a contract test reading this file
  off disk. It also forces a genuinely hard call the build-time guard does not: `/api/[...path]` is
  declared credential-bearing because its value is an arbitrary api path, but blanking every
  `/api/*` segment at runtime would destroy route debuggability. Neither answer is free, and it is
  not this slice's decision.
- Two rows are judgement calls a reader should be able to challenge. `accept-invitation/[invitationId]`
  is credential-bearing even though acceptance also requires a signed-in invitee — classified by the
  worse direction, because it is the exact segment a vocabulary would have missed. `/api/[...path]`
  is credential-bearing by transitivity rather than by its own semantics.
- The suite pins a standing claim: no credential-bearing segment is reachable as a **page** route
  except the acknowledged `accept-invitation` case. Anything new that is both credential-bearing and
  page-routed has to be argued for by editing that assertion — in review, deliberately.

## Sources

- [ADR 0130](0130-share-token-rides-the-url-fragment.md) — the route this generalises from.
- [ADR 1030](1030-url-bearing-values-are-reduced-by-the-parser-or-redacted.md) — the path-preserving
  primitive and its assumption; [ADR 1028](1028-gitleaks-pinned-by-sha256-digest.md) /
  [ADR 1029](1029-the-guards-were-guarding-nothing.md) — the "an unwired guard is not a gate"
  argument, and why it does not force a standalone script here.
- `packages/telemetry/src/scrub.pii-contract.test.ts` — the read-source-off-disk + anti-vacuity
  method this suite copies.
- Vault: _A URL scrubber that keeps the pathname is only safe while no credential lives in a path
  segment — a share-token route silently opts out of the guarantee_.
