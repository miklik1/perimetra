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

// The soft-404 regression guard (ADR 1037). This is the assertion the test
// above CANNOT make: an unknown path is resolved by the router before any
// segment renders, so it answers 404 even in an app where every `notFound()`
// has silently degraded — that spec stays green with the bug live. It did,
// here, for the whole life of this skeleton.
//
// `notFound()` sets the status by throwing while the response is still
// uncommitted. Put a Suspense boundary above the call site — a root
// `app/loading.tsx` is the usual way it happens, since that file IS a boundary
// wrapped around every route — and React has already flushed the shell at 200
// by the time the throw lands. The status cannot be taken back, so the app
// serves 404 markup under a 200: a soft-404, which crawlers index as a real
// page. Nothing about it is visible in a browser.
//
// `app/not-found-probe/page.tsx` is a permanent segment whose render calls
// `notFound()`. Reintroduce a root-level `loading.tsx`, or wrap the root layout
// in `<Suspense>`, and this assertion is what goes red.
test("an explicit notFound() commits a 404 status, not a soft-404", async ({ page }) => {
  const response = await page.goto("/not-found-probe");

  // The status is the whole point — the markup below would be identical at 200.
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
});
