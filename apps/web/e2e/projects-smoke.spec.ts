import { expect, test } from "@playwright/test";

/**
 * Real-stack smoke (`@smoke` — runs ONLY under `playwright.smoke.config.ts`,
 * which greps for the tag; the mock-mode config grep-inverts it). End-to-end
 * over the REAL services: Next proxy → API → postgres/redis from the compose
 * stack. One linear journey through the reference resource (spec §7.8):
 *
 *   sign up (unique email) → /projects → create a project → archive it
 *   → /account shows the signed-in user.
 *
 * Signup happens over the Better Auth HTTP route (there is no signup page in
 * the web exemplar — login-form.tsx drives `signIn` only); `page.request`
 * shares the browser context's cookie jar, so the httpOnly session cookie set
 * by the API authenticates the subsequent page loads.
 *
 * The UI renders the default `cs` locale (ADR 0020) — assertions use the
 * Czech catalog, same as the mock-mode specs.
 */
test("signup → create project → archive → account shows the user @smoke", async ({ page }) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `smoke-${unique}@example.com`;
  const projectName = `Smoke project ${unique}`;

  // -- Sign up via the same-origin proxy (`/api/auth/*` → API service). ------
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Smoke Tester", email, password: "Smoke-pass-123!" },
  });
  expect(signUp.ok(), `sign-up failed: ${signUp.status()} ${await signUp.text()}`).toBe(true);

  // -- /projects: the cookie passes the proxy gate + AuthGuard. --------------
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projekty" })).toBeVisible();

  // -- Create: shared-schema form → POST /v1/projects (Idempotency-Key). -----
  await page.getByLabel("Název").fill(projectName);
  await page.getByRole("button", { name: "Vytvořit projekt" }).click();

  // The list invalidates and refetches from the real API — the new row appears.
  // The list is the o-LIST `<table>` since the Phase-2 reskin (ADR 0121): rows
  // are `<tr>`, so match on the ARIA row role rather than a DOM tag.
  const row = page.getByRole("row").filter({ hasText: projectName });
  await expect(row).toBeVisible();

  // -- Archive: POST /v1/projects/:id/archive flips the status. --------------
  // Each row's controls carry a name-qualified aria-label ("Archivovat <name>")
  // so they stay distinguishable across rows.
  const archiveButton = row.getByRole("button", { name: `Archivovat ${projectName}` });
  await archiveButton.click();
  // The row swaps the archive button for the status badge (optimistically, then
  // confirmed by the server revalidation); scope to the row — a toast says
  // "Archivováno." too.
  await expect(row.getByText("Archivováno")).toBeVisible();
  await expect(archiveButton).toHaveCount(0);

  // -- /account: the session's user, straight from GET /v1/me. ---------------
  await page.goto("/account");
  await expect(page.getByText(`Přihlášen jako ${email}`)).toBeVisible();
});
