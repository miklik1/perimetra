import { defineConfig, devices } from "@playwright/test";

/**
 * Web E2E (ADR 0025) — Playwright in **mock mode**. `webServer` boots `next dev`
 * with the BFF's server-side mock turned on (`NEXT_PUBLIC_ENABLE_MSW=true`,
 * `NEXT_PUBLIC_MSW_MOCKS=auth,users`), so every spec runs against the same
 * framework-agnostic mock routes the unit suite uses (ADR 0018) — hermetic and
 * deterministic, no real backend. Mocks resolve in-process for RSC prefetch and
 * over HTTP for the browser, so both render paths see the same data.
 *
 * Kept off the cached `turbo test` task (browsers + a dev server make it
 * non-deterministic to cache); CI runs it in a dedicated `e2e-web` job.
 */
const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // @smoke specs need the REAL stack (api + postgres + redis) and run only
  // under playwright.smoke.config.ts — keep them out of this hermetic suite.
  grepInvert: /@smoke/,
  // Fail a CI run that left a `.only` in a spec.
  forbidOnly: !!process.env.CI,
  // Retry once in CI to absorb dev-server cold-start flake; never locally.
  retries: process.env.CI ? 1 : 0,
  // The dev server is single-instance; keep specs serial-friendly. One worker in
  // CI for stable ordering, parallel locally.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // Capture a trace on the first retry so CI failures are debuggable.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `next dev` (development) — `mocksEnabled` in handle-api-request.ts also
    // requires NODE_ENV !== "production", which dev satisfies.
    command: "pnpm dev",
    url: baseURL,
    timeout: 120_000,
    // Reuse an already-running dev server locally; always fresh in CI.
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_ENABLE_MSW: "true",
      NEXT_PUBLIC_MSW_MOCKS: "auth,users",
    },
  },
});
