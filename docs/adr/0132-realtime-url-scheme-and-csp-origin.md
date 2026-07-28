# ADR 0132 — `NEXT_PUBLIC_REALTIME_URL` enforces wss, and the CSP realtime origin stops falling back to the dev default

**Status:** Accepted (2026-07-28 — Phase A security sweep, finding PER-SEC-3). Extends [ADR 1021](1021-api-url-https-gate-keys-on-loopback-not-node-env.md) (the loopback-not-`NODE_ENV` rule, here applied to the second credential-bearing origin the web app configures) and tightens [ADR 0026](0026-web-security-headers-csp.md)'s `connect-src` composition. The endpoint itself is [ADR 0029](0029-realtime-package-centrifugo.md). Supersedes nothing; both files are **skeleton-owned**, so the fix is owed upstream (see Consequences).

## Context

Two defects, one variable, found together because they are two halves of the same
omission: nothing in the repo ever asserted what a realtime endpoint may be.

**1 — the env schema constrained nothing.** `packages/config/src/env/web.ts`
declared the Centrifugo endpoint as:

```ts
NEXT_PUBLIC_REALTIME_URL: z.string().url().optional(),
```

`.url()` reads as a constraint and is not one here. Verified against the zod
actually installed in this repo (4.4.3): `z.string().url()` **passes**
`ws://rt.example.com/connection/websocket`, passes `ws://192.168.1.5:8000/x`, and
passes `ftp://x.com` — it fails only on a value that is not a URL at all. So the
schema admitted a plaintext websocket to an arbitrary remote host.

That is not a cosmetic looseness. The browser connects to this endpoint
**directly** — realtime deliberately bypasses the BFF, and only the token mint
goes through `/api` — carrying the Centrifugo connection JWT issued by
`GET /v1/realtime/token`. Over a non-loopback `ws://` that token, and every
`user:<id>` / `org:<id>` frame that follows it, crosses a real network in clear.
It is exactly the exposure class ADR 1021 closed for `API_URL`, on the one other
origin the web app is allowed to name.

**2 — the production CSP derived its realtime origin from the dev default.**
`apps/web/proxy.ts` composed the `connect-src` entry as:

```ts
new URL(env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:8000/connection/websocket").origin;
```

With the variable unset in a production build, `isDev` is false — so the blanket
dev `ws:` is correctly absent — and yet the shipped policy still allow-listed the
literal `ws://localhost:8000`. The two origins immediately above it,
`sentryOrigin` and `posthogOrigin`, have **no fallback**: unset yields
`undefined` and is dropped by the `.filter(Boolean)`. The realtime origin was the
sole deviation from that pattern, and the deviation is what produced the
misconfiguration.

The fallback also bought development nothing. Dev appends a blanket `ws:` on the
next line, which covers the entire local stack — and covers it on whatever port
`docker/.env` remapped Centrifugo to, which the hard-coded `:8000` does not (on
this box it is `8002`, so the fallback was already naming the wrong port).

## Decision

**The scheme rule is absolute and tier-independent.** `NEXT_PUBLIC_REALTIME_URL`
now carries a refinement mirroring `API_URL`'s exactly, reusing the same
module-private `isLoopbackOrigin` helper (which never inspects the protocol, so
it serves `ws`/`wss` unchanged):

```ts
url === undefined || url.startsWith("wss://") || (url.startsWith("ws://") && isLoopbackOrigin(url));
```

Accepted: `wss://` to anything; `ws://` to `localhost`, `*.localhost`, the fully
range-checked `127.0.0.0/8`, and `[::1]`. Refused: everything else.

"Absolute" is forced by the mechanics, not merely preferred, and three
independent reasons converge on it:

- `NODE_ENV` describes the **build**, never the network path — the mistake ADR
  1021 corrected for `API_URL` in both directions at once.
- A per-field `.refine` **cannot see another field.** t3-env's default
  `parseWithDictionary` validates every key independently. The only cross-field
  hook is `createFinalSchema`, and supplying it **replaces** that per-key parse
  with a single object parse for the entire web env — changing issue paths and
  unknown-key handling everywhere in order to express one rule. That is a blast
  radius far larger than the problem.
- This is a **client** variable, so the refinement runs a second time inside the
  browser bundle, where `process.env.APP_TIER` and `VERCEL_TARGET_ENV` are not
  inlined and read as `undefined`. A tier-conditional rule would therefore be
  silently **lenient** client-side — the same hazard already documented for
  `TIER` in that file. A scheme-only rule is deterministic in both contexts, so
  server and client agree by construction rather than by luck.

**The CSP origin is added only when configured.** The `?? "ws://localhost:8000/…"`
fallback is deleted; `realtimeOrigin` is now structurally identical to
`sentryOrigin` — parse when present, `undefined` when absent, dropped by the
filter. An unconfigured production build now emits `connect-src 'self'`.

## Consequences

- **A build that currently sets a non-loopback `ws://` will hard-fail.** This is
  the intended outcome and it is a real breaking change: `next build` exits 1 on
  an env-validation throw. Verified safe on this box (`apps/web/.env.local` uses
  `ws://localhost:8002/…`) and for `scripts/create-project/index.mjs`, which
  stamps a loopback URL. Gitignored env files on other machines cannot be checked
  from here — the failure is loud and its message names the rule.
- **`http://` and `https://` are now rejected for this variable too**, which
  zod's `.url()` was letting through. A deliberate tightening, recorded here so
  nobody reads it later as a bug: a non-websocket scheme in a Centrifugo endpoint
  is a misconfiguration in every environment.
- **`SKIP_ENV_VALIDATION` bypasses the refinement entirely**, and this residual is
  stated rather than papered over. `@t3-oss/env-core` returns `runtimeEnv`
  **before building any schema**, so under that flag no refinement runs at all.
  The compensating control is `assertTierInvariants`, which hard-refuses
  `SKIP_ENV_VALIDATION` on a **prod** tier — but only on a prod tier. A
  stage/preview container build (the documented Docker path in
  `docs/operations/deploy.md` is exactly this path) can therefore still ship a
  plaintext non-loopback `ws://`. Closing that would mean mirroring the check
  inside `assertTierInvariants`; it is not done here, and the gap is real.
- **A production deploy that relied on the implicit `ws://localhost:8000` entry
  will now have its websocket blocked by CSP** until it sets the variable. That
  is the correct behaviour — the policy should describe the deployment, not the
  developer's laptop — but it is a live-behaviour change on an unconfigured
  production deploy, so `docs/operations/deploy.md` now says to set the variable
  explicitly.
- **No e2e test covers `connect-src`.** `apps/web/e2e/security-headers.spec.ts`
  asserts `frame-ancestors`, `object-src` and the script nonce and nothing else,
  so the two new unit cases in `apps/web/proxy.test.ts` are the _only_ guard
  against this regression class. They must not be folded into an existing case.
  Both were disarm-verified: restoring the fallback reds them, and neutering the
  refinement reds eight of the ten new env cases.
- **Owed upstream.** `packages/config/src/env/web.ts` and `apps/web/proxy.ts` are
  both skeleton-owned files, and the `?? "ws://localhost:8000/…"` fallback is
  skeleton-authored — every project stamped from `fullstack-skeleton` carries
  both defects verbatim. The debt is recorded **here**, in this row of the ADR
  index, and belongs in the vault's engineering findings at the next sweep; the
  skeleton repo is deliberately **not** edited from this slice.
- Unrelated drift fixed in passing: `SECURITY.md` documented the CSP as
  `frame-ancestors 'self'` while `apps/web/proxy.ts` has always emitted `'none'`
  (pinned by `proxy.test.ts`). The doc now matches the code and states why
  `'none'` is required.

## Sources

- `packages/config/src/env/web.ts` — the refinement and its comment block; the
  `isLoopbackOrigin` helper it reuses.
- `packages/config/src/env/web.test.ts` — accept/reject tables, the
  `NODE_ENV=development`/`production` pins proving the rule is not `NODE_ENV`-keyed,
  and a case asserting the naked `.url()` verdict so a future zod bump cannot make
  the regression test vacuous.
- `apps/web/proxy.ts` / `apps/web/proxy.test.ts` — the `connect-src` composition
  and its two new cases.
- `@t3-oss/env-core` 0.13.11 `dist/index.js` — `skipValidation` returning
  `runtimeEnv` before schema construction; `parseWithDictionary`'s per-key
  validation; the `createFinalSchema` escape hatch.
- zod 4.4.3, measured in this repo: `z.string().url()` accepts `ws://`, `wss://`
  and `ftp://` alike.
- [ADR 1021](1021-api-url-https-gate-keys-on-loopback-not-node-env.md),
  [ADR 0026](0026-web-security-headers-csp.md),
  [ADR 0029](0029-realtime-package-centrifugo.md),
  `packages/config/src/env/assert-tier-invariants.ts`.
