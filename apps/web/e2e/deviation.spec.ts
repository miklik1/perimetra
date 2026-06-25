import { expect, test } from "@playwright/test";

/**
 * CORE_SPEC §6 — the out-of-frustum deviation guarantee (ADR 0076). `/scene-lab`
 * renders a synthetic gate with one deviated piece; `?cam=away` points the camera
 * AWAY from the gate so the deviated piece is behind the frustum. The §6 invariant
 * is that NO camera angle can hide a deviated piece — so an edge marker MUST
 * appear. Runs against `next dev` (the dev-only route is reachable; ADR 0025).
 */
test("an off-screen deviated piece still surfaces an edge marker (CORE_SPEC §6)", async ({
  page,
}) => {
  await page.goto("/scene-lab?cam=away");

  const canvas = page.locator('[data-testid="scene-lab"] canvas');
  await canvas.waitFor({ state: "visible", timeout: 60_000 });

  // The projector toggles the marker to display:flex once it sees the piece is
  // off-screen; toBeVisible auto-retries while software-WebGL settles its frames.
  const marker = page.locator("[data-deviation-marker]").first();
  await expect(marker).toBeVisible({ timeout: 30_000 });
});

test("the deviated piece is NOT marked when it is comfortably in frame", async ({ page }) => {
  await page.goto("/scene-lab");

  const canvas = page.locator('[data-testid="scene-lab"] canvas');
  await canvas.waitFor({ state: "visible", timeout: 60_000 });

  // Default framing fits the whole gate — the deviated piece is on-screen, so its
  // marker stays hidden (markers are an off-screen cue, not permanent chrome).
  await page.waitForTimeout(2_000);
  const marker = page.locator("[data-deviation-marker]").first();
  await expect(marker).toBeHidden();
});
