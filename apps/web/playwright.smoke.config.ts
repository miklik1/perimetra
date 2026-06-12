import { defineConfig, devices } from "@playwright/test";

/**
 * Web E2E — **real-stack smoke** (the complement of `playwright.config.ts`'s
 * hermetic mock mode, ADR 0025). No mocks anywhere: `webServer` boots `next
 * dev` with the API proxy target configured (`API_URL`, the repo's name for
 * it; `API_PROXY_TARGET` is honored as an alias) and MSW explicitly OFF, so
 * `/api/auth/*` and `/api/v1/*` reach the real API service, which needs the
 * compose stack (postgres/redis/...) behind it.
 *
 * Prerequisites (the runner — integrator's smoke job or a human — owns them):
 *   docker compose -f docker/compose.yaml up -d
 *   pnpm --filter api build && pnpm --filter api migrate && pnpm --filter api start
 *
 * Ports/env all flow through process.env so local override and CI default
 * shapes both work: the API target defaults to the api service's own default
 * (`http://localhost:4000` — infra port overrides in docker/.env don't move
 * the API itself). The web port defaults to 3000 to match the API's default
 * `WEB_ORIGIN` (Better Auth trusted-origin check); override `SMOKE_WEB_PORT`
 * only together with `WEB_ORIGIN` on the API.
 *
 * Only `@smoke`-tagged specs run here (`grep`); the mock-mode config must
 * `grepInvert` the same tag so the two suites stay disjoint over a shared
 * `e2e/` dir.
 */
const PORT = Number(process.env.SMOKE_WEB_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;
const apiProxyTarget =
  process.env.API_PROXY_TARGET ?? process.env.API_URL ?? "http://localhost:4000";

export default defineConfig({
  testDir: "./e2e",
  grep: /@smoke/,
  // Fail a CI run that left a `.only` in a spec.
  forbidOnly: !!process.env.CI,
  // Retry once in CI to absorb dev-server cold-start flake; never locally.
  retries: process.env.CI ? 1 : 0,
  // Real shared backend state (one database) — keep the suite serial everywhere.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // Capture a trace on the first retry so CI failures are debuggable.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Bypass the package script (it pins --port 3000) so SMOKE_WEB_PORT works.
    command: `pnpm exec next dev --port ${PORT}`,
    url: baseURL,
    timeout: 120_000,
    // NEVER reuse: a leftover mock-mode dev server on this port would make the
    // suite pass against fixtures — the one outcome this config exists to avoid.
    reuseExistingServer: false,
    env: {
      // Real backend target: flips the BFF + rewrites out of mock mode (the
      // tri-state gate in next.config.js / handle-api-request.ts)...
      API_URL: apiProxyTarget,
      // ...and the explicit "false" pins it even if a shell exports MSW vars.
      NEXT_PUBLIC_ENABLE_MSW: "false",
    },
  },
});
