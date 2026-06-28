import { expect, test } from "@playwright/test";

// ADR 0026: the home document carries the static security-header set (from
// next.config.js `headers()`) plus the per-request nonce-based CSP (from
// proxy.ts middleware). This is the real verification that the header pipeline
// is wired AND that the nonce-CSP doesn't break the page (the no-FOUC inline
// script must still run under the strict policy — the other specs would fail if
// it didn't, since they render the page).
test("home response carries the security headers and a nonce CSP", async ({ page }) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();

  const headers = response!.headers();

  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=63072000");
  expect(headers["permissions-policy"]).toContain("camera=()");

  // CSP present, strict (no `unsafe-inline` for scripts), and carries a fresh
  // per-request nonce on script-src.
  const csp = headers["content-security-policy"];
  expect(csp).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);

  // The page actually rendered under the strict CSP — the inline theme script
  // ran (it carries the nonce) and the heading is visible.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
