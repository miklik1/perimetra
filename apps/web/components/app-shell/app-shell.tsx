"use client";

import type { ReactNode } from "react";

import { useAuth } from "@repo/auth/react";
import { usePathname } from "@repo/navigation";
import { TooltipProvider } from "@repo/ui";

import { visibleNavEntries, type NavContext } from "../../lib/nav-registry";
import { usePlatformAdmin, useRole } from "../../lib/use-role";
import { IconRail } from "./icon-rail";
import { MobileTopBar } from "./mobile-top-bar";
import { SideRail } from "./side-rail";
import { TabBar } from "./tab-bar";

/**
 * Routes that render their OWN session-less chrome — public share links, auth
 * flows — or are print sheets. The shell never frames them: an authenticated
 * visitor previewing a buyer `/nabidka/:token`, a user mid `/two-factor`, and
 * critically the two `/traveler` print routes, which are `window.print()`ed so
 * app chrome must NOT bleed onto the A4 (the live §4.2 bug this closes — the old
 * top-bar shell missed the `/traveler` suffix).
 */
const PUBLIC_PREFIXES = ["/login", "/nabidka", "/accept-invitation", "/two-factor"];
const PRINT_SUFFIX = "/traveler";

function isChromelessRoute(pathname: string): boolean {
  if (pathname.endsWith(PRINT_SUFFIX)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Screens that own a primary BOTTOM action bar, so the mobile tab bar would
 * double up (§4.4): the configurator wizard nav (the print sheets are already
 * chromeless above). On these the tab bar is suppressed and the surface fills the
 * full mobile height.
 */
function ownsBottomActionBar(pathname: string): boolean {
  return pathname === "/configurator" || pathname.startsWith("/configurator/");
}

/**
 * The persistent authenticated app shell (ADR 0118 / design/README.md §4). Wraps
 * every authenticated surface in ONE registry-driven frame with three density
 * renderings — a 220 px labelled rail (≥1280), a 68 px icon rail (768–1279), a
 * bottom tab bar + top app bar (<768) — toggled by CSS breakpoints, never a JS
 * media query, so there is no hydration hazard and the a11y tree carries only the
 * one visible nav. Membership is invariant across breakpoints; only density
 * changes (§4.4) — every rendering is a pure consumer of `visibleNavEntries`.
 *
 * Mounted in app/providers.tsx (not the root layout) because it reads
 * `useAuth`/`/v1/me` via `useRole`/`usePlatformAdmin`, which need the Api + Auth
 * context. It WRAPS `{children}` — a horizontal rail beside the content on
 * desktop/tablet, a top-bar + bottom-bar column on mobile — replacing the old
 * in-flow top header. That is why the configurator's hand-coupled
 * `h-[calc(100dvh-3.5rem)]` is gone: the surface now just fills the sized
 * `<main>` slot this shell provides.
 *
 * When there is no session yet, or on a chromeless route, it renders `{children}`
 * BARE — never null — so the page's own AuthGuard fallback still shows. The flip
 * to framed is joint with that AuthGuard (both read the same `isAuthenticated`),
 * so nothing resizes on auth-resolve. `useRole`/`usePlatformAdmin` fail-closed
 * while `/v1/me` resolves, so a first-paint flash shows only Nastavení rather
 * than a wrong role's links.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated, user } = useAuth();
  const role = useRole();
  const isPlatformAdmin = usePlatformAdmin();

  if (!isAuthenticated || isChromelessRoute(pathname)) {
    return <>{children}</>;
  }

  const ctx: NavContext = { role, isPlatformAdmin };
  const entries = visibleNavEntries(ctx);
  const userLabel = user?.name ?? user?.email ?? undefined;
  // Suppress the mobile tab bar where the surface owns a bottom action bar, AND
  // when the main group is empty (role null / the fail-closed first-paint flash)
  // — an empty bordered strip reads as broken; the footer stays reachable via the
  // top-bar menu.
  const hasMainEntries = entries.some((e) => e.group === "main");
  const showTabBar = !ownsBottomActionBar(pathname) && hasMainEntries;

  return (
    <TooltipProvider>
      <div className="flex h-dvh w-full flex-col md:flex-row">
        <SideRail entries={entries} pathname={pathname} className="hidden xl:flex" />
        <IconRail entries={entries} pathname={pathname} className="hidden md:flex xl:hidden" />
        <MobileTopBar
          entries={entries}
          pathname={pathname}
          userLabel={userLabel}
          className="flex md:hidden"
        />
        {/* Role-neutral content slot — NOT a <main>: every page renders its own
            <main>, so a wrapping <main> here would nest two "main" landmarks on
            every framed route. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
        {showTabBar && <TabBar entries={entries} pathname={pathname} className="flex md:hidden" />}
      </div>
    </TooltipProvider>
  );
}
