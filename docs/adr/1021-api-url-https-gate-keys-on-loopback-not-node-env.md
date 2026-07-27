# ADR 1021 — The `API_URL` https gate keys on the host's loopback-ness, not on `NODE_ENV`

**Status:** Accepted (2026-07-19) — HQ-ruled default, Martin ratify queued. Amends [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) (the BFF origin this var configures) and corrects a rule that predates the ≥1000 band. **The upstream debt is DISCHARGED:** `fullstack-skeleton` landed the same rule and then corrected this ADR's justification in `cf519cd`; that correction is drained here (2026-07-27, W13).

> **CORRECTION (2026-07-20, drained from upstream `cf519cd` 2026-07-27) — the cache-hit explanation below is FALSE. The decision stands; part of its justification does not.**
>
> This ADR explained the "too tight" symptom by saying `web:check-types` "could not pass" pre-fix and "only ever passed via a turbo CACHE HIT" populated by `SKIP_ENV_VALIDATION=1` runs. [ADR 1027](1027-check-types-preflight-config-load.md) disproved that, and the reproduction was re-run independently before this note was written:
>
> - `next typegen` reports a `next.config.js` load failure as an **unhandled promise rejection and still exits 0**. Measured here, bare, with turbo not involved at all: `API_URL=http://staging.internal:4000 APP_TIER=prod pnpm exec next typegen` prints `❌ Invalid environment variables` and `Unhandled Rejection` — and exits **0**. The pre-fix chain `next typegen && tsc --noEmit` therefore never short-circuited and exited **0** too.
> - So the pre-fix `check-types` did not pass _by cache_; it passed **on a cold, cache-free, correctly-failing environment**, because the failure was swallowed. No cache state, and no `SKIP_ENV_VALIDATION`-populated cache entry, is needed to explain the observation — and none was ever evidenced.
> - What survives: the **`build`** half. `next build` does _not_ swallow the throw (measured: exit **1**, `Failed to load next.config.js`), so `NODE_ENV=production` being set by the toolchain really did break `pnpm build` on the documented local `API_URL`. The "too tight" finding is real; only its `check-types`/cache-hit account was wrong.
> - The same claim was independently disproven in `mercata`'s tree.
>
> Consequence for the reader: wherever this ADR says the gate "only ever passed by cache", read "the gate never ran, because a chained command reported its failure as an exit-0". The `SKIP_ENV_VALIDATION` workaround critique in the Consequences section is retained but is a _separate_, weaker point — it was a real habit, not the mechanism that hid this defect. The fix for the swallowing is [ADR 1027](1027-check-types-preflight-config-load.md)'s preflight.
>
> Booked under the lesson of [ADR 1022](1022-elements-chain-non-href-segments.md): a change correct in itself can falsify a soundness claim written elsewhere, and no green gate detects that. The inline copy of this reasoning at `packages/config/src/env/web.ts` is corrected in lockstep.

**Provenance — found HERE, paid back upstream.** Surfaced by this repo's own `git push`: the pre-push hook's `check-types` job failed on a tree whose full gate had just been run green by hand. The failure was not in the changed code — it was a latent defect in the skeleton-authored env rule that every stamped project inherits. (The original text attributed the surfacing to a `--force` run missing a masking turbo cache; per the correction above that mechanism is not established — see [ADR 1027](1027-check-types-preflight-config-load.md).)

## Context

`packages/config/src/env/web.ts` requires `API_URL` to be `https://` so the BFF proxy cannot relay bearer tokens and session cookies in plaintext (`handle-api-request.ts` forwards credentials). The rule was gated on `NODE_ENV`:

```ts
url === undefined ||
  (process.env.NODE_ENV ?? "development") === "development" ||
  url.startsWith("https://");
```

`NODE_ENV` describes the **build**, never the **network path**, so it could not express the boundary the rule actually cares about. It was therefore wrong in both directions at once.

**Too tight — and it silently broke the gate.** `next typegen` and `next build` set `NODE_ENV=production` themselves. So on any box configured the documented way — `.env.example` suggests `API_URL=http://localhost:4000` — the refinement rejected its own project's local configuration, and `pnpm build` genuinely failed (`next build` exits 1 on a config-load throw — measured).

_Corrected 2026-07-20 (see the note at the top; disproof in [ADR 1027](1027-check-types-preflight-config-load.md))._ The original text continued: "…and `web:check-types` could not pass. It appeared to pass only because turbo served a **cache hit**, populated by runs carrying `SKIP_ENV_VALIDATION=1`." **That is false.** `next typegen` reports the config-load failure as an unhandled rejection and **exits 0**, so `next typegen && tsc --noEmit` proceeded and the gate was green **bare, cold, with no cache and no `SKIP_ENV_VALIDATION`** — reproduced directly. The pre-push hook and CI (which sets the identical `API_URL: http://localhost:4000` in `ci.yml`) were not gated on cache state; they were running a chain whose first command could not fail. This is still the "the gate you run locally is not the gate CI runs" class one turn further on — but the sharper statement is the one [ADR 1027](1027-check-types-preflight-config-load.md) makes: **a gate that can be satisfied without running is not a gate.**

The project had adapted to the symptom rather than the cause — the operating note "gate honestly with `SKIP_ENV_VALIDATION=1`" is exactly the workaround, and it made the `build` failure look like a known quirk. _Corrected 2026-07-20:_ it did **not** hide the `check-types` defect; nothing had to hide that one, since the chain reported it as an exit-0 regardless.

**Too loose — the security half.** Whenever `NODE_ENV` _was_ `development`, http was permitted to **any** host. A developer pointing at a shared staging backend (`http://staging.internal:4000`, `http://192.168.1.5:4000`) forwarded real credentials in plaintext across a real network — precisely the exposure the rule exists to prevent. The dangerous case and the safe case were on the same side of the test.

## Decision

**Gate on whether the host is a LOOPBACK address.** That is the property the security argument rests on: loopback traffic never reaches a wire, so there is nothing to intercept. Everything else must be `https://`, in every `NODE_ENV`.

```ts
url === undefined || url.startsWith("https://") || isLoopbackOrigin(url);
```

`isLoopbackOrigin` is written to be conservative, because it **grants** an exemption and so must never fail open:

- `localhost`, and per RFC 6761 any `*.localhost` subdomain.
- The whole `127.0.0.0/8` block with every octet range-checked — not a `^127\.` prefix test, which would also admit the _hostname_ `127.0.0.1.evil.com`, resolving wherever its owner points it.
- IPv6 `::1`. `URL.hostname` returns it bracketed and already canonically compressed, so long-hand spellings normalise into the comparison.
- An unparseable URL returns `false` rather than throwing; `.url()` has already rejected it, and an exemption must not fail open.

## Consequences

- **The gate is now unbreakable by the toolchain.** `pnpm check-types` and `pnpm build` both pass **bare and cache-busted** (`--force`, no `SKIP_ENV_VALIDATION`), verified. _Corrected 2026-07-20:_ the trailing claim that "the pre-push hook now gates on correctness rather than on cache state" mis-stated the prior failure — the hook had not been gating on cache state, it had been running a chain whose first command (`next typegen`) exits 0 on a config-load failure. Correctness-gating arrived with [ADR 1027](1027-check-types-preflight-config-load.md)'s preflight, not with this ADR.
- **`SKIP_ENV_VALIDATION=1` is retired as a routine workaround for this repo.** It remains meaningful for its designed purpose (building an image with no env present), but it is no longer required to run the local gate, and the operating notes that told contributors to reach for it are updated. A workaround that hides a defect costs more than the defect.
- **This is a net TIGHTENING of the security rule, not a relaxation** — the direction worth being explicit about, since the change was motivated by a broken build. A non-loopback http origin is now refused in every `NODE_ENV`; previously it was allowed in development.
- **Accepted cost:** a developer deliberately pointing at a remote http backend (a LAN box, a shared staging host) is now refused and must use https or a local tunnel. That is the intended outcome, not collateral: it is the one configuration that actually leaked credentials over a network.
- **Pinned by tests** in `packages/config/src/env/web.test.ts`, in both directions: http-loopback accepted under `NODE_ENV=production` (the regression that broke the gate), http-remote rejected under `NODE_ENV=development` (the security regression), plus a table of loopback spellings that must pass and a table of near-miss hostnames — `127.0.0.1.evil.com`, `localhost.evil.com`, an out-of-range octet, `192.168.1.5`, `128.0.0.1` — that must not.
- **Generalisation.** A security predicate should test the property its own rationale names. This one's rationale was "plaintext over the wire", but the predicate tested the build mode — a proxy that was neither necessary nor sufficient for it. When a guard is gated on an ambient variable rather than on the thing it describes, expect it to be simultaneously too strict somewhere and too permissive somewhere else. And when a gate can be satisfied by a cache, it is not yet a gate. _Corrected 2026-07-20:_ that closing line named the wrong mechanism here (no cache was involved — see the note at the top); the generalisation it should have reached is [ADR 1027](1027-check-types-preflight-config-load.md)'s: **a chained command only gates if its failure mode is an exit code.** The first half of this bullet — a predicate must test the property its rationale names — is unaffected and is the load-bearing lesson of this ADR.
- **Fleet exposure — the upstream debt is now discharged.** The rule is skeleton-authored, so **every stamped project carries both halves** — including the broken `web:check-types`. _Corrected 2026-07-20:_ that breakage is **not** "masked by turbo caching … right up until a cache miss". It is masked unconditionally, on every box, cold or warm, because `next typegen` swallows the failure and exits 0 ([ADR 1027](1027-check-types-preflight-config-load.md)) — which makes the fleet exposure strictly worse than described: there is no cache miss that eventually surfaces it. This repo is where it was found and was fixed first; `fullstack-skeleton` landed the rule and this correction in `cf519cd`, and `web-native-skeleton` carries the same rule in its own lineage. Every other derived repo should drain it.
- **A workaround had been normalised into documentation.** The instruction to reach for `SKIP_ENV_VALIDATION=1` when the gate complains predates this ADR and converted a real failure (the `build` half, which does fail closed) into an expected quirk. _Corrected 2026-07-20:_ the original heading — "a gate that only ever passed by cache" — is withdrawn; the `check-types` gate passed because its failure was swallowed, not because of a cache, and this habit is therefore a contributing bad practice rather than the mechanism that hid the defect. Where a project's docs or agent notes still say that, they should be corrected rather than carried.

## Sources

- [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) — the BFF proxy whose credential forwarding this rule protects.
- `packages/config/src/env/web.ts` (`isLoopbackOrigin`, the `API_URL` refinement); `apps/web/.env.example`; `.github/workflows/ci.yml` (the CI `API_URL`).
- RFC 6761 §6.3 (`localhost` and `*.localhost` resolve to loopback); RFC 1122 §3.2.1.3 (`127.0.0.0/8` is the loopback block).
