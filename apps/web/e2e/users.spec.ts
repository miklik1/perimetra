import { expect, test } from "@playwright/test";

// Smoke: the home page's "Users (RSC-prefetched)" section is fed by the BFF
// (ADR 0018). In mock mode (NEXT_PUBLIC_MSW_MOCKS=auth,users) the `users` group
// is served from the shared mock fixtures in-process during the RSC prefetch,
// so the list renders the mock accounts with no real backend. This proves the
// prefetch → dehydrate → HydrationBoundary → useQuery pipeline against the mock.
test("users list renders the mocked BFF users", async ({ page }) => {
  await page.goto("/");

  // The page renders in the default cs locale (ADR 0020), so all copy is the
  // Czech catalog. Scope to the RSC-prefetched section by its translated title
  // ("Uživatelé (přednačteno v RSC)").
  const section = page.locator("section").filter({ hasText: "Uživatelé (přednačteno v RSC)" });
  await expect(
    section.getByRole("heading", { name: "Uživatelé (přednačteno v RSC)" }),
  ).toBeVisible();

  // The mock `users` fixtures (packages/api-mocks): Ada Lovelace + Alan Turing.
  // With mocks on the query resolves to `success` (not the jsonplaceholder parse
  // error the demo shows when mocks are off). The status value itself is not
  // translated — only the "stav:" label is — so we assert on the interpolated value.
  await expect(section.getByText("stav:")).toContainText("success");
  await expect(section.getByText("Ada Lovelace")).toBeVisible();
  await expect(section.getByText("ada@example.com")).toBeVisible();
  await expect(section.getByText("Alan Turing")).toBeVisible();
});
