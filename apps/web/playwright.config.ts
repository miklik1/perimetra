import { defineConfig, devices } from "@playwright/test";

/**
 * Web E2E (ADR 0025) — Playwright in **mock mode**. `webServer` boots `next dev`
 * with the BFF's server-side mock turned on (`NEXT_PUBLIC_ENABLE_MSW=true`, no
 * group selector → every mock group active), so every spec runs against the same
 * framework-agnostic mock routes the unit suite uses (ADR 0018) — hermetic and
 * deterministic, no real backend. Mocks resolve in-process for RSC prefetch and
 * over HTTP for the browser, so both render paths see the same data.
 *
 * Kept off the cached `turbo test` task (browsers + a dev server make it
 * non-deterministic to cache); CI runs it in a dedicated `e2e-web` job.
 */
// Default 3000. On a shared multi-seat box the first process to bind :3000 owns
// it, and `reuseExistingServer` (below) will then silently drive THAT app —
// identical routes + UI, so specs go green against the wrong repo (see
// e2e/README.md — the port-ownership trap). A second seat sets `WEB_PORT` to
// claim its own port. This is the SAME env knob `apps/web`'s dev script reads
// (`next dev --port ${WEB_PORT:-3000}`) and it is threaded into `webServer.env`
// below, so the URL Playwright waits on and the port the dev server binds can
// never drift apart. (The real-stack smoke config uses its own `SMOKE_WEB_PORT`
// knob for the same reason — it must also match the API's `WEB_ORIGIN`.)
//
// A HUMAN picks a port; automation must not be asked to remember. `WEB_PORT`
// unset therefore means "an interactive run on the conventional port", and
// `scripts/claude-gate.sh` derives a per-checkout one instead of inheriting a
// constant every repo would share. Note what this default canNOT be: a derived
// port here would silently move the port `pnpm dev` and `pnpm test:e2e` disagree
// about for every developer, to fix a problem only automation has.
const PORT = Number(process.env.WEB_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

// FAIL CLOSED ON A PORT THIS RUN DOES NOT OWN (ADR 1038).
// `reuseExistingServer` is a convenience for a human who already has `pnpm dev`
// up. For anything automated it is a silent-substitution hazard: a run that finds
// the wait-URL answering never boots its own server, never says so, and reports
// the OTHER app's verdict as its own. Measured, Playwright 1.60, foreign HTTP
// server on the wait-URL: reuse-true drove the impostor; reuse-false refused to
// start at all — `Error: http://localhost:PORT is already used ...`, exit 1, zero
// tests run. Loud beats silent, so automation declares ownership here.
//
// A dedicated knob rather than `CI=1`, deliberately. `CI` is a bundle: it also
// flips `forbidOnly`, `retries` 0→1, `workers` parallel→1 and the reporter to
// github+html (which writes `playwright-report/` and emits `::error ::` workflow
// commands into whatever captures this run's output), and it leaks into the
// `next dev` child. Four unrelated behaviour changes to buy one is not a
// targeted knob; this is. `CI` still implies ownership so CI is unchanged.
// `||`, not `??`: an env var set to the empty string is "not set" here, and `??`
// would let `CI=""` shadow a real `WEB_E2E_OWN_SERVER=1`.
const ownServer = Boolean(process.env.CI || process.env.WEB_E2E_OWN_SERVER);

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
    // requires the non-prod tier (ADR 0104), which dev satisfies.
    command: "pnpm dev",
    url: baseURL,
    timeout: 120_000,
    // Reuse an already-running dev server only for an interactive local run.
    // Automation (the Stop-hook gate, CI) sets `ownServer` and gets a hard
    // "already used" error on a port it does not own — see the note above.
    reuseExistingServer: !ownServer,
    env: {
      // No NEXT_PUBLIC_MSW_MOCKS selector: an empty selector activates EVERY
      // mock group (selectRoutes — @repo/api-mocks config), so this hermetic
      // suite mocks the whole API and never silently drops a group as `pnpm gen
      // api-resource` adds one. A pinned list drifted before — `projects` was
      // added but the selector still read "auth,users", leaving it uncovered.
      NEXT_PUBLIC_ENABLE_MSW: "true",
      // Bind the dev server to the SAME port the URL above waits on (the dev
      // script reads WEB_PORT), so a `WEB_PORT` override moves both in lockstep.
      WEB_PORT: String(PORT),
      // Explicitly clear the backend origin. `next dev` loads `apps/web/.env.local`,
      // where a working machine has a real `API_URL` (this repo runs an api) — and
      // an E2E run that mocks the whole API while carrying a backend origin is the
      // ambiguous data source `assertTierInvariants` refuses on preview (ADR 0104).
      // Empty string ⇒ undefined via the env schema's `emptyStringAsUndefined`, so
      // the suite is hermetic by construction rather than by a clean checkout.
      API_URL: "",
    },
  },
});
