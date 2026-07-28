import { notFound } from "next/navigation";

/**
 * The 404-STATUS fixture for `e2e/not-found.spec.ts` (ADR 1037). Permanent, and
 * deliberately so.
 *
 * It exists because the unknown-route spec cannot catch the bug it looks like
 * it covers. An unknown path is resolved by the ROUTER, before any segment
 * renders, so Next answers 404 even in an app where every `notFound()` call
 * site has silently degraded to a soft-404 (200 + 404 markup). Only a segment
 * that renders and THEN calls `notFound()` exercises the status-setting path.
 *
 * PERIMETRA HAS NINE REAL CALL SITES AND STILL NEEDS THIS FIXTURE — the reason
 * is worth stating, because "we have our own 404 routes, delete the probe" is
 * the obvious and wrong conclusion. Not one of the nine is reachable by the
 * hermetic e2e suite: `/site/[projectId]`, `/quotes/[id]/…`, `/orders/[id]/…`,
 * `/invoices/[id]/…` and `/platform/…` all sit behind `PROTECTED_PREFIXES` in
 * `apps/web/proxy.ts`, so an anonymous GET is redirected to `/login` and never
 * renders; and `/brand-lab`, `/scene-lab`, `/drawing-lab` call `notFound()`
 * only when `NODE_ENV === "production"`, while the suite runs `next dev`. An
 * unauthenticated, always-on call site is exactly what the status assertion
 * needs, and this route is the only one in the tree.
 *
 * Safe to ship: this route's entire behaviour is "answer 404", which is exactly
 * what a nonexistent path does. It exposes nothing, renders no data, and is
 * indistinguishable from a typo'd URL to any visitor or crawler.
 *
 * A derived repo may delete it — but only after repointing the spec at one of
 * its own `notFound()` call sites. Deleting it and the assertion together
 * removes the only guard on ADR 1037, and the failure it guards against is
 * invisible: the page still LOOKS like a 404 in a browser.
 */
export default function NotFoundProbe(): never {
  notFound();
}
