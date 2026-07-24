import { expect, test } from "./fixtures/auth";

/**
 * Real-stack smoke for `/` — the ADR 0125 "Přehled" dashboard (Phase 2, Wave D),
 * which replaced the fullstack-skeleton root demo. Runs ONLY under
 * `playwright.smoke.config.ts` (`@smoke`); the mock-mode config grep-inverts the
 * tag. This restores the e2e coverage `/` lost when the demo (and its three
 * mock-mode specs) was retired — and it has to be real-stack, because the
 * dashboard's whole point is the `GET /v1/me/dashboard-summary` aggregate, which
 * has no mock group: in mock mode that path is an unmatched route (a genuine
 * 404), so a mock server could not satisfy the API assertion below.
 *
 * The journey rides the shared single-sign-in auth fixture (`fixtures/auth.ts`):
 * ONE sign-up per worker, reused as `storageState`, so the suite can grow
 * authed specs without walking into the strict auth rate limit (ADR 0044).
 *
 * SHAPE UNDER TEST — a freshly provisioned org (Better Auth `databaseHooks`,
 * ADR 0055) with an OWNER membership and no data yet:
 *   - the full non-workshop key set (all four KPIs + funnel + expiring quotes),
 *     which is the server-side role filter (ADR 0056/0125) answering "owner";
 *   - all counts genuinely 0 and both widgets in their empty state — the honest
 *     zero of a new tenant, never a fabricated demo number.
 * The UI renders the default `cs` locale (ADR 0020), so assertions are Czech.
 */

test("authed / renders the real dashboard for a fresh org owner @smoke", async ({
  authedPage,
  authedSession,
}) => {
  await authedPage.goto("/");

  // The greeting <h1> mounts only AFTER AuthGuard resolves and the framed
  // content renders (the bare fallback has no <h1>). The salutation itself is
  // time-of-day dependent, so anchor on the first name — generated at run time
  // by the fixture, hence a value only the REAL stack under test can echo back
  // (e2e/README.md: never anchor a smoke assertion to shared UI).
  const heading = authedPage.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText(authedSession.firstName);

  // -- KPI row: the owner (non-workshop) key set, all four present. ----------
  const kpis = authedPage.getByRole("region", { name: "Klíčové ukazatele" });
  await expect(kpis.getByText("Aktivní zakázky")).toBeVisible();
  await expect(kpis.getByText("Otevřené nabídky")).toBeVisible();
  await expect(kpis.getByText("Přijaté nabídky")).toBeVisible();
  await expect(kpis.getByText("Brzy vyprší")).toBeVisible();
  // A brand-new org has nothing yet — four tiles, four honest zeros.
  await expect(kpis.getByText("0", { exact: true })).toHaveCount(4);

  // -- Funnel + expiring quotes: present for a non-workshop role, both empty. -
  await expect(authedPage.getByText("Prodejní trychtýř")).toBeVisible();
  await expect(authedPage.getByText("Platnost brzy končí")).toBeVisible();
  await expect(authedPage.getByText("Nic v nejbližší době.")).toBeVisible();

  // -- Activity feed (always present, every role) — empty for a new org. -----
  await expect(authedPage.getByText("Poslední aktivita")).toBeVisible();
  await expect(authedPage.getByText("Zatím žádná aktivita.")).toBeVisible();
});

test("the dashboard aggregate answers over the real API with the owner shape @smoke", async ({
  authedPage,
}) => {
  // Same cookie jar as the page — this is the aggregate the RSC prefetches.
  // Mock mode has no `nav` route group, so a 200 here proves the real API
  // answered (the port-ownership / wrong-server trap e2e/README.md warns about).
  const response = await authedPage.request.get("/api/v1/me/dashboard-summary");
  expect(
    response.ok(),
    `dashboard-summary failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);

  const summary = (await response.json()) as {
    kpis: Record<string, number>;
    funnel?: { quotes: number; orders: number };
    expiringQuotes?: unknown[];
    activity: unknown[];
  };

  // Role-filtered OPTIONAL keys (ADR 0125): an owner sees the full shape — the
  // price-blind `workshop` subset would be missing every key below `activeOrders`.
  expect(summary.kpis.activeOrders).toBe(0);
  expect(summary.kpis.openQuotes).toBe(0);
  expect(summary.kpis.acceptedQuotes).toBe(0);
  expect(summary.kpis.expiringSoon).toBe(0);
  expect(summary.funnel).toEqual({ quotes: 0, orders: 0 });
  expect(summary.expiringQuotes).toEqual([]);
  expect(summary.activity).toEqual([]);
});

test("anonymous / redirects to the login page @smoke", async ({ page }) => {
  // `/` is deliberately NOT a proxy PROTECTED_PREFIX (a `/` prefix would match
  // every route), so the client `AuthGuard` owns this bounce — and the org-scoped
  // aggregate 403s an anonymous caller regardless. Assert the bounce happens and
  // that no dashboard content is rendered on the way.
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("region", { name: "Klíčové ukazatele" })).toHaveCount(0);
});
