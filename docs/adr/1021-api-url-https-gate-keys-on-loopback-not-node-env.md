# ADR 1021 — The `API_URL` https gate keys on the host's loopback-ness, not on `NODE_ENV`

**Status:** Accepted (2026-07-19) — HQ-ruled default, Martin ratify queued. Amends [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) (the BFF origin this var configures) and corrects a rule that predates the ≥1000 band. **Owed upstream** to `fullstack-skeleton` — the rule is skeleton-authored and every derived repo carries it.

**Provenance.** Found by this session's own `git push`: the pre-push hook's `check-types` job failed on a tree whose full gate had just been run green by hand. The failure was not in the changed code — it was a latent defect in the gate itself, surfaced only because a `--force` run happened to miss the turbo cache.

## Context

`packages/config/src/env/web.ts` requires `API_URL` to be `https://` so the BFF proxy cannot relay bearer tokens and session cookies in plaintext (`handle-api-request.ts` forwards credentials). The rule was gated on `NODE_ENV`:

```ts
url === undefined ||
  (process.env.NODE_ENV ?? "development") === "development" ||
  url.startsWith("https://");
```

`NODE_ENV` describes the **build**, never the **network path**, so it could not express the boundary the rule actually cares about. It was therefore wrong in both directions at once.

**Too tight — and it silently broke the gate.** `next typegen` and `next build` set `NODE_ENV=production` themselves. So on any box configured the documented way — `.env.example` suggests `API_URL=http://localhost:4000` — the refinement rejected its own project's local configuration, and `web:check-types` could not pass. It appeared to pass only because turbo served a **cache hit**: the cache had been populated by runs carrying `SKIP_ENV_VALIDATION=1`, which disables the refinement entirely. The pre-push hook does not set that variable, so the hook was, in effect, gated on cache state rather than on correctness. CI sets the identical `API_URL: http://localhost:4000` (`ci.yml`) and rode the same condition. This is the "the gate you run locally is not the gate CI runs" class again, one turn further on: here the gate did not even reliably run itself.

The project had adapted to the symptom rather than the cause — the operating note "gate honestly with `SKIP_ENV_VALIDATION=1`" is exactly the workaround, and it hid the defect by making the failure look like a known quirk.

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

- **The gate is now unbreakable by the toolchain.** `pnpm check-types` and `pnpm build` both pass **bare and cache-busted** (`--force`, no `SKIP_ENV_VALIDATION`), verified. The pre-push hook now gates on correctness rather than on cache state.
- **`SKIP_ENV_VALIDATION=1` is retired as a routine workaround for this repo.** It remains meaningful for its designed purpose (building an image with no env present), but it is no longer required to run the local gate, and the operating notes that told contributors to reach for it are updated. A workaround that hides a defect costs more than the defect.
- **This is a net TIGHTENING of the security rule, not a relaxation** — the direction worth being explicit about, since the change was motivated by a broken build. A non-loopback http origin is now refused in every `NODE_ENV`; previously it was allowed in development.
- **Accepted cost:** a developer deliberately pointing at a remote http backend (a LAN box, a shared staging host) is now refused and must use https or a local tunnel. That is the intended outcome, not collateral: it is the one configuration that actually leaked credentials over a network.
- **Pinned by tests** in `packages/config/src/env/web.test.ts`, in both directions: http-loopback accepted under `NODE_ENV=production` (the regression that broke the gate), http-remote rejected under `NODE_ENV=development` (the security regression), plus a table of loopback spellings that must pass and a table of near-miss hostnames — `127.0.0.1.evil.com`, `localhost.evil.com`, an out-of-range octet, `192.168.1.5`, `128.0.0.1` — that must not.
- **Generalisation.** A security predicate should test the property its own rationale names. This one's rationale was "plaintext over the wire", but the predicate tested the build mode — a proxy that was neither necessary nor sufficient for it. When a guard is gated on an ambient variable rather than on the thing it describes, expect it to be simultaneously too strict somewhere and too permissive somewhere else. And when a gate can be satisfied by a cache, it is not yet a gate.
- **Owed upstream.** The rule is skeleton-authored, so `fullstack-skeleton` and every repo derived from it carry both halves of this defect — including the broken `web:check-types`, which will likewise be masked by turbo caching wherever `SKIP_ENV_VALIDATION` is in local use.

## Sources

- [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) — the BFF proxy whose credential forwarding this rule protects.
- `packages/config/src/env/web.ts` (`isLoopbackOrigin`, the `API_URL` refinement); `apps/web/.env.example`; `.github/workflows/ci.yml` (the CI `API_URL`).
- RFC 6761 §6.3 (`localhost` and `*.localhost` resolve to loopback); RFC 1122 §3.2.1.3 (`127.0.0.0/8` is the loopback block).
