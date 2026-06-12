import { expect, test } from "@playwright/test";

// Smoke: the home page renders and defaults to the cs locale (ADR 0020 — cs is
// the runtime fallback, resolved from the absent locale cookie server-side).
test("home renders with the cs default locale", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Web" })).toBeVisible();

  // The LocaleSwitcher button reads `${t("label")}: ${t(locale)}` — for the
  // default cs catalog that is "Jazyk: Čeština".
  await expect(page.getByRole("button", { name: "Jazyk: Čeština" })).toBeVisible();
});
