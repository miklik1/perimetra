# Design — Quality-infra sweep (web E2E, shared test config, security headers, CI hardening)

**Date:** 2026-06-04
**Status:** Implemented — Playwright web E2E (`apps/web/e2e`, mock-mode) + shared
`tooling/vitest-config` (ADR 0025), `next.config` headers + per-request nonce CSP
(ADR 0026), and the CI hardening (parallel jobs + `.turbo` cache + coverage +
advisory audit) shipped
**Decision records:** [ADR 0025](../../adr/0025-web-e2e-playwright-shared-vitest-config.md)
(web E2E + vitest config), [ADR 0026](../../adr/0026-web-security-headers-csp.md)
(security headers/CSP)

Four quality-infrastructure pieces brainstormed together.

## 1. Web E2E — Playwright (mock mode)

- `apps/web/playwright.config.ts` + `apps/web/e2e/`. `webServer` boots
  `next dev` with `NEXT_PUBLIC_ENABLE_MSW=true NEXT_PUBLIC_MSW_MOCKS=auth,users`
  → hermetic, no backend (ADR 0018 server-side mocks).
- Smoke specs: home renders + i18n cs default; login → `/account` (authed,
  AuthGuard); create-user mutation reflects in the list. Mock sessions reset
  per spec (reuse `resetSessions` from `@repo/api-mocks`).
- Scripts: `apps/web` `test:e2e` (+ `test:e2e:ui`); root passes through.
- CI: a dedicated `e2e-web` job — `pnpm exec playwright install --with-deps`,
  then run; cache the browser binaries. Kept off the cached `turbo test` task
  (browsers + server make it non-deterministic to cache).
- Four-runner split (amends ADR 0005): Vitest (web+shared unit/component) / Jest
  (mobile unit) / Playwright (web E2E) / Maestro (mobile E2E).

## 2. Shared test config — `tooling/vitest-config` (no `@repo/testing`)

- New `tooling/vitest-config` exporting a base Vitest config + the jsdom/RTL/
  jest-dom `vitest.setup` (the pattern currently duplicated in `@repo/ui` and the
  api/auth jsdom harnesses): `@vitejs/plugin-react`, `environment: "jsdom"`,
  `resolve.dedupe: ["react","react-dom"]`, setup (cleanup + jest-dom).
- Each package's `vitest.config.ts` shrinks to extend it + its own `include`.
  Packages still list `vitest.setup` in tsconfig include for matcher types (the
  known gotcha).
- **No `@repo/testing` package** (ADR 0025): shared _fixtures/factories_ reuse
  `@repo/api-mocks/fixtures`; shared _config_ is this tooling package; render
  wrappers stay app-local. Avoids a boundary-heavy grab-bag.
- Tooling, not a runtime package → no `eslint-plugin-boundaries` element; it is
  referenced from `vitest.config.ts`, not imported in source.

## 3. Web security headers + CSP (ADR 0026)

- Static header set in `apps/web/next.config.js` `headers()`: HSTS,
  `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`,
  `Permissions-Policy`.
- **Nonce-based CSP** in `apps/web/proxy.ts` (the existing middleware): generate a
  per-request nonce, set the CSP header, and thread the nonce to the layout's
  inline no-FOUC theme `<script nonce={…}>` so it survives a strict `script-src
'self' 'nonce-…'` (no `unsafe-inline` for scripts).
- `connect-src` includes `'self'` + the Sentry ingest origin when
  `NEXT_PUBLIC_SENTRY_DSN` is set (telemetry, ADR 0021). Dev relaxes for HMR.
- `frame-ancestors 'self'` (standalone), parameterized behind a config default so
  embedding later is a config change.

## 4. CI hardening

All four selected, wired into `.github/workflows/ci.yml`:

- **Dependency audit** — `audit-ci` (or `pnpm audit --audit-level=high`) as a
  gate at a chosen severity; a separate job so it can be advisory→blocking
  deliberately.
- **Bundle-size budgets** — `size-limit` (or `@next/bundle-analyzer` + a
  threshold check) on the web build output; fail over budget. Budgets recorded in
  `apps/web` config.
- **jsx-a11y lint** — add `eslint-plugin-jsx-a11y` to the web ESLint config
  (`tooling/eslint/next.js`), recommended ruleset; mobile keeps RN a11y props
  (no equivalent plugin).
- **Coverage thresholds** — Vitest `coverage` (v8) with a minimum %; start
  modest, ratchet up. Wire into `tooling/vitest-config` so it's uniform.

## Testing / verification

- Playwright specs are themselves the E2E verification; run locally via
  `pnpm --filter web test:e2e`.
- `tooling/vitest-config` is exercised by every package's existing suite once they
  extend it (no behavior change → suites stay green).
- Security headers: a Playwright assertion on response headers (CSP present,
  nonce on the inline script, `frame-ancestors 'self'`).

## Out of scope / deferred

- Mobile a11y automated testing, visual-regression, mutation testing.
- Real-backend E2E profile (mock mode only, per the scoping decision).
- Penetration testing / runtime WAF (ops concern).

## Files (for the plan)

**New:** `tooling/vitest-config/**`; `apps/web/playwright.config.ts`,
`apps/web/e2e/**`; CI job additions in `.github/workflows/ci.yml`; size-limit +
audit-ci configs.

**Changed:** every `packages/*/vitest.config.ts` (extend the shared base) +
their `package.json` devDep; `apps/web/next.config.js` (headers + size config),
`apps/web/proxy.ts` (CSP + nonce), `apps/web/app/layout.tsx` (nonce on the inline
script); `tooling/eslint/next.js` (jsx-a11y); `tooling/vitest-config` (coverage
thresholds); root `package.json` (e2e/audit scripts); `knip.json`
(tooling/vitest-config entry); `docs/adr/0025-*.md`, `0026-*.md`,
`docs/adr/README.md`, `ARCHITECTURE.md`.
