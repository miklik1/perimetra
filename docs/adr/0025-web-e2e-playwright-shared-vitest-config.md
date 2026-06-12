# ADR 0025 — Web E2E with Playwright (mock-mode); shared `tooling/vitest-config`; no `@repo/testing` grab-bag

**Status:** Accepted (2026-06-04). Amends [ADR 0005](0005-testing-two-runner-split.md)
(testing strategy).

## Context

ADR 0005 set the test runners: Vitest (web + shared packages), Jest (mobile),
Maestro (mobile E2E via EAS). Two gaps surfaced in the quality-infra brainstorm:

1. **No web end-to-end tests.** Mobile has Maestro; the web app has only Vitest
   unit/component tests. A full-stack web flow (login → authed route → mutation)
   is unverified.
2. **Per-package Vitest boilerplate.** Each package re-declares the same jsdom +
   `@vitejs/plugin-react` + RTL/jest-dom setup (`@repo/ui`, the api/auth jsdom
   harnesses). It drifts and is copy-pasted.

A `@repo/testing` package was considered for #2 (and shared render/factory
helpers) but rejected — see Decision.

## Decision

**Add Playwright as the web E2E runner, run in mock mode**, and **dedupe Vitest
config into `tooling/vitest-config`** rather than a runtime testing package.

- **Playwright** lives in `apps/web/e2e/`, config `apps/web/playwright.config.ts`.
  Specs run against `next dev` started with the existing MSW/BFF mock mode
  (`NEXT_PUBLIC_ENABLE_MSW=true`, `NEXT_PUBLIC_MSW_MOCKS=auth,users`) — so E2E is
  **hermetic and deterministic with no real backend** (ADR 0018's server-side
  mocks make this possible). CI gets a dedicated job (installs browsers, builds
  or dev-serves, runs specs). The four-runner split is now: Vitest (web + shared
  unit/component) / Jest (mobile unit) / **Playwright (web E2E)** / Maestro
  (mobile E2E).
- **`tooling/vitest-config`** — a shared base config + setup file (jsdom, the
  `@vitejs/plugin-react` + `resolve.dedupe` + `vitest.setup` cleanup/jest-dom
  pattern), consumed by each package's `vitest.config.ts` (like `eslint-config` /
  `typescript-config`). Packages keep a one-line config that extends it.
- **No `@repo/testing` runtime package.** Shared _test data_ reuses the existing
  `@repo/api-mocks/fixtures` (already factory-shaped, e.g. `fixtures/users.ts`);
  shared _config_ is `tooling/vitest-config`. A `@repo/testing` package that
  imported `api-mocks` + `validators` + `ui` + RTL would be a wide, boundary-
  heavy grab-bag — exactly what [ADR 0008](0008-shared-package-boundaries.md)
  retired `@repo/shared` to avoid. Render wrappers are small and platform-
  specific, so they stay app-local.

## Consequences

- Web gets real end-to-end coverage with zero backend flakiness, reusing the mock
  infra already built. The same mock fixtures back unit and E2E tests.
- Vitest setup is written once in `tooling/`; per-package configs shrink to an
  extend + includes. No new governed runtime edges (it's tooling, referenced from
  `vitest.config.ts`, not imported in source — so `eslint-plugin-boundaries` is
  unaffected).
- Playwright browsers add CI time (a separate cached job) and a dev dependency.
- The ADR 0005 matrix grows to four runners; the split rationale (right tool per
  layer) is unchanged.

## Sources

- Playwright (test runner, web server reuse, CI):
  <https://playwright.dev/docs/test-webserver> (verified 2026-06-04).
- [ADR 0005](0005-testing-two-runner-split.md) (runner split this amends),
  [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) (server-side mocks that
  make hermetic web E2E possible), [ADR 0008](0008-shared-package-boundaries.md)
  (no grab-bag — why there is no `@repo/testing`).
