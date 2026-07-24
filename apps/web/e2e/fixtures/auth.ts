import { test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * Real-stack auth fixtures for the `@smoke` suite (`playwright.smoke.config.ts`).
 *
 * WHY THIS EXISTS: every authed-only surface (`/` — the ADR 0125 dashboard —
 * `/orders`, `/quotes`, …) needs a session before it renders anything, and the
 * API rate-limits the credential endpoints at `AUTH_RATE_LIMIT_MAX` per minute
 * per IP (ADR 0044, the strict tier — only `/get-session` is generous). A suite
 * that signs in per spec walks straight into that ceiling as the smoke suite
 * grows. So this signs up ONCE per worker process, keeps the resulting
 * `storageState` (the httpOnly Better Auth session cookie), and hands every
 * authed spec a page that already carries it — the same single-sign-in +
 * storageState harness the `scripts/verify/capture-*.mjs` eyes-on scripts use.
 *
 * Sign-UP (not sign-in) is deliberate: the smoke stack is a fresh database in CI
 * (`smoke-e2e` composes postgres and runs migrations, never the seed), so there
 * is no pre-existing account to sign in as. A signup also gets the Better Auth
 * `databaseHooks` org provisioning (ADR 0055) for free — one org, an OWNER
 * membership, and an `activeOrganizationId` on the session — which is exactly
 * the org-admin role the org-scoped endpoints gate on.
 *
 * The identity is returned alongside the state because it is the suite's
 * REAL-STACK ANCHOR: `name`/`email` are generated at run time, so any assertion
 * against them is one a mock-mode server (or another seat's app on the same
 * port — see e2e/README.md's port-ownership trap) could not have produced.
 */

/** Signed-up identity + the session state it produced. */
export interface AuthedSession {
  email: string;
  /** Full name as signed up — `"<firstName> Tester"`. */
  name: string;
  /** First word of `name`; the dashboard greeting renders exactly this. */
  firstName: string;
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
}

/** Meets the password policy (ADR 0040) — same credential shape as `projects-smoke`. */
const PASSWORD = "Smoke-pass-123!";

/**
 * Memoised per worker PROCESS (Playwright runs each worker in its own process,
 * so module state is worker state — and the smoke config pins `workers: 1`
 * because the suite shares one real database). A worker-scoped fixture would be
 * the textbook form, but `baseURL` is a TEST-scoped option and a worker fixture
 * may not depend on one; memoising a test-scoped fixture keeps the URL source
 * single (the config) instead of re-deriving `SMOKE_WEB_PORT` here, where it
 * could drift from `playwright.smoke.config.ts`.
 */
let signUpOnce: Promise<AuthedSession> | undefined;

async function signUp(browser: Browser, baseURL: string): Promise<AuthedSession> {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const firstName = `Smoke${unique}`;
  const name = `${firstName} Tester`;
  const email = `smoke-auth-${unique}@example.com`;

  // Sign up over the same-origin proxy (`/api/auth/*` → API service), exactly
  // as the browser would: `autoSignIn` returns the session cookie on the
  // response, and this context's cookie jar keeps it.
  const context = await browser.newContext({ baseURL });
  try {
    const response = await context.request.post("/api/auth/sign-up/email", {
      data: { name, email, password: PASSWORD },
    });
    if (!response.ok()) {
      throw new Error(`sign-up failed: ${response.status()} ${await response.text()}`);
    }
    return { email, name, firstName, storageState: await context.storageState() };
  } finally {
    await context.close();
  }
}

interface AuthFixtures {
  /** The signed-up identity backing `authedPage` (assert against it). */
  authedSession: AuthedSession;
  /** A page in its own context carrying the session cookie. */
  authedPage: Page;
}

export const test = base.extend<AuthFixtures>({
  authedSession: async ({ browser, baseURL }, use) => {
    if (!baseURL) throw new Error("baseURL is required (playwright.smoke.config.ts sets it)");
    signUpOnce ??= signUp(browser, baseURL);
    await use(await signUpOnce);
  },

  authedPage: async ({ browser, baseURL, authedSession }, use) => {
    // A dedicated context per test: same session, isolated storage/state, so a
    // spec can never leak client-side state into the next one.
    const context = await browser.newContext({
      baseURL,
      storageState: authedSession.storageState,
    });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

export { expect } from "@playwright/test";
