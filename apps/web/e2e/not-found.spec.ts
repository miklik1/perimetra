import { expect, test } from "@playwright/test";

// Smoke: an unknown path renders the app's not-found UI (app/not-found.tsx) with
// a 404 status from Next.
test("unknown route renders the 404 page", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
  // Default cs locale (ADR 0020): the description is the Czech catalog string.
  await expect(page.getByText("Stránka nenalezena")).toBeVisible();
});
