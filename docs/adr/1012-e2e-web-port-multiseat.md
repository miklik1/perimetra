# ADR 1012 — The web E2E port is `WEB_PORT`-configurable so a multi-seat box doesn't silently drive the wrong app

**Status:** Accepted (2026-07-17) — **Skeleton-authored (channel-A drain of `de34dd2`, by content; ADR re-authored, not cherry-picked); HQ-ruled, Martin ratify queued.** Extends [ADR 0025](0025-web-e2e-playwright-shared-vitest-config.md) (the mock-mode Playwright suite).

## Context

`apps/web/playwright.config.ts` (the mock-mode suite) hard-coded `const PORT = 3000` and boots its dev server with `webServer.reuseExistingServer: !process.env.CI`. Locally, if something already listens on :3000, Playwright reuses it instead of booting its own server.

Every skeleton-derived repo defaults `next dev` to :3000. On a machine running **more than one derived repo at once** (multiple agent seats, common in this fleet), the first process to bind :3000 owns it, and every other repo's `pnpm --filter web test:e2e` then **silently drives that first app**. The routes and UI are identical across derived repos, so specs go **green against the wrong repo's application**. This is not hypothetical: in the fleet an eyes-on verification passed against a sibling seat's dev server; only a database query for a value the wrong app could not have produced exposed it. `reuseExistingServer: !CI` is precisely what makes the substitution silent.

## Decision

Make the mock-suite E2E port a single env-driven knob, `WEB_PORT`, threaded end-to-end so the wait-URL and the server's bound port cannot drift apart:

- `apps/web`'s `dev` script already reads it: `next dev --port ${WEB_PORT:-3000}`.
- `playwright.config.ts` now derives `const PORT = Number(process.env.WEB_PORT ?? 3000)`, builds `baseURL` from it, **and** threads `WEB_PORT: String(PORT)` into `webServer.env`, so the port Playwright waits on is exactly the port the dev server binds (the mock config boots via `pnpm dev`, so the env `WEB_PORT` flows straight through the dev script's `--port ${WEB_PORT:-3000}`).

A second seat claims its own port with `WEB_PORT=3100 pnpm --filter web test:e2e`; because no sibling is on :3100, Playwright boots its own fresh server and drives the right app. CI is unchanged: it sets `CI`, so `reuseExistingServer` is off and every job boots a fresh server on the default port inside its own isolated runner.

A new `apps/web/e2e/README.md` documents the trap, the `WEB_PORT` override, and — for when a run looks suspicious — the **port-ownership proof recipe**: `ss -ltnp` to find the PID bound to the port, `readlink /proc/<pid>/cwd` + `/proc/<pid>/environ` to prove which repo it belongs to, and the discipline of anchoring a mock-mode assertion to a fact only the real system-under-test produces (never the shared UI). It also warns never to `pkill -f "next-server"` across seats (it kills siblings and can match its own argv — use `[n]ext-server`).

## Consequences

- Two seats can run the mock E2E suite concurrently without one silently validating the other's app, and a single knob (already honoured by the dev script) is the whole mechanism — no new dependency, no config duplication.
- **Default behaviour is unchanged** when `WEB_PORT` is unset: PORT resolves to 3000 exactly as before. The knob is opt-in; the durable defence against the silent-substitution class is the README recipe plus the ability to isolate ports at all.
- **Test-infra only.** No application code, request handling, or stored data is touched.
- **Perimetra delta — the real-stack smoke config was already multi-seat-safe.** `apps/web/playwright.smoke.config.ts` (the `@smoke` complement, not present in the skeleton) already reads its own `SMOKE_WEB_PORT` knob, bypasses the package script (`pnpm exec next dev --port ${PORT}`), and pins `reuseExistingServer: false` — so a leftover mock-mode server on the port can never make it pass against fixtures. It is left as-is: its port must also match the API's `WEB_ORIGIN` (Better Auth trusted-origin check), so a separate knob overridden alongside `WEB_ORIGIN` is correct, not a duplication to unify with `WEB_PORT`.
- A stronger "per-repo port offset stamped at `create-project` time" was considered and deferred: it hard-codes a port map into the template, and the env knob already covers the concurrent-seat case that actually bites. Recorded as a possible future generator change, not built here.

## Sources

- Channel-A drain of skeleton `de34dd2` — `feat(security): client Sentry URL-query scrub + multi-seat e2e port (ADR 1011/1012)`; the owed-upstream item this closes for perimetra.
- [ADR 0025](0025-web-e2e-playwright-shared-vitest-config.md) — the mock-mode E2E suite this configures.
