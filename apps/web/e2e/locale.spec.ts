import { expect, test } from "@playwright/test";

// Smoke: the LocaleSwitcher cycles the active locale (ADR 0020). The cookie is
// the single source of truth — a click writes it and `router.refresh()` re-runs
// the RSC render in the new locale, so the whole tree (and the button label)
// re-renders. cs → en here.
test("locale switch cycles cs → en", async ({ page }) => {
  await page.goto("/");

  const switcher = page.getByRole("button", { name: "Jazyk: Čeština" });
  await expect(switcher).toBeVisible();

  await switcher.click();

  // After refresh the button reads the en catalog: "Language: English".
  await expect(page.getByRole("button", { name: "Language: English" })).toBeVisible();
});
