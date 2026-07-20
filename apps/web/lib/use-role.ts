"use client";

import { useAuthQueries, useQuery } from "@repo/api/react";
import type { OrgRole } from "@repo/validators";

/**
 * The caller's active-org role (ADR 0056), read from the SAME `/v1/me` source
 * the BE guards enforce on — so FE gating can never drift from server-side
 * enforcement. `null` while the session probe is in flight or the user is
 * anonymous. Exported (not just the derived booleans below) so the nav
 * registry (CAR-12, `lib/nav-registry.ts`) can build its `{ role,
 * isPlatformAdmin }` visibility context directly from it.
 */
export function useRole(): OrgRole | null {
  const authQueries = useAuthQueries();
  const { data } = useQuery(authQueries.me());
  return data?.role ?? null;
}

/**
 * FE mirror of the server price-blind rule — FAIL-CLOSED: prices show only for a
 * CONFIRMED `admin`/`sales` role. While the role is unknown (loading/anonymous)
 * or `workshop`, prices stay hidden. Defence in depth only — the authoritative
 * strip is server-side (the API never ships prices to a workshop client).
 */
export function usePriceBlind(): boolean {
  const role = useRole();
  return role !== "admin" && role !== "sales";
}

/**
 * Whether the caller is an org `admin` (ADR 0056) — gates the org-admin surface
 * links (`/admin`: price tables + product versions). FAIL-CLOSED: `false` while
 * loading/anonymous. UX only — the server enforces via `@RequireRole('admin')`.
 */
export function useIsAdmin(): boolean {
  return useRole() === "admin";
}

/**
 * Whether the caller may see COST and MARGIN, as distinct from seeing money at
 * all (ADR 0116). `usePriceBlind` is the ADR 0056 money/no-money line — admin
 * and sales both see the sell price, workshop sees none. Purchase cost and the
 * margin it implies are a narrower class: `admin` only.
 *
 * Decided with Martin during the ADR 0114 Phase 1b configurator slice. A rep
 * quoting in front of a customer does not need the purchase price on screen, and
 * the margin floor is enforced server-side at `issue` regardless of what the
 * client renders (`quotes.service.ts` — the authoritative guard). The cost of
 * the choice is that a sales user meets a floor breach as a 422 at issue rather
 * than as a live meter; that was accepted deliberately.
 *
 * FAIL-CLOSED: `false` while loading/anonymous. This one is UX-only in a
 * stronger sense than its siblings — the API ships cost to any non-workshop
 * session, so this hides it, and a determined sales user could read it off the
 * wire. It is a screen-hygiene rule, NOT a security boundary; do not let a
 * future surface treat it as one.
 */
export function useCanSeeCost(): boolean {
  return useRole() === "admin";
}

/**
 * FE mirror of the customers module's role gate (ADR 0082/CAR-23): admin sees
 * the whole org, sales sees their own — workshop is 403 (price-blind, no buyer
 * data). FAIL-CLOSED: `false` while loading/anonymous. UX only — the server's
 * `@RequireRole('admin', 'sales')` on `CustomersController` is authoritative.
 */
export function useCanManageCustomers(): boolean {
  const role = useRole();
  return role === "admin" || role === "sales";
}

/**
 * FE mirror of the platform/vendor operator flag (ADR 0062), read from the SAME
 * `/v1/me` source the BE `PlatformGuard` enforces. Gates the vendor console
 * (publish + release assignment). FAIL-CLOSED: `false` while loading/anonymous.
 * Defence in depth — the authoritative gate is server-side.
 */
export function usePlatformAdmin(): boolean {
  const authQueries = useAuthQueries();
  const { data } = useQuery(authQueries.me());
  return data?.isPlatformAdmin ?? false;
}
