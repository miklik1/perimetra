"use client";

import { useAuth } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { isActive, Link, usePathname } from "@repo/navigation";
import { cn } from "@repo/ui";

import { visibleNavEntries } from "../lib/nav-registry";
import { usePlatformAdmin, useRole } from "../lib/use-role";

/**
 * Routes that render their OWN session-less chrome — a public share link or
 * an auth flow. The shell must never appear there, even for an authenticated
 * visitor (e.g. an admin previewing a buyer's `/nabidka/:token` link, or a
 * signed-in user mid `/two-factor` challenge who hasn't finished logging in).
 */
const PUBLIC_PREFIXES = ["/login", "/nabidka", "/accept-invitation", "/two-factor"];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Persistent, role-aware top nav (CAR-12). Mounted once in the root layout,
 * ABOVE `{children}`, so it survives client-side navigation between surfaces
 * instead of remounting per route. Pure chrome over `NAV_ENTRIES`
 * (lib/nav-registry.ts): filters against the caller's LIVE role/platform-admin
 * context — the same `/v1/me` source the API guards enforce on, so the shell
 * can never dangle a link the server would 403 — and renders NOTHING until
 * there's an authenticated, non-public-route session to show it for. Both
 * `useRole`/`usePlatformAdmin` fail-closed (null/false) while `/v1/me` is
 * still resolving, so a first-paint flash briefly shows only `account`
 * rather than a wrong role's links.
 */
export function NavShell() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  const role = useRole();
  const isPlatformAdmin = usePlatformAdmin();
  const t = useTranslations("nav");

  if (!isAuthenticated || isPublicRoute(pathname)) return null;

  const entries = visibleNavEntries({ role, isPlatformAdmin });

  return (
    <header className="border-border bg-chrome sticky top-0 z-40 border-b">
      <nav className="flex h-14 items-center gap-1 overflow-x-auto px-4" aria-label={t("main")}>
        <Link
          to={{ route: "home" }}
          className="font-display mr-4 shrink-0 text-lg font-semibold tracking-tight"
        >
          Perimetra
        </Link>
        <ul className="flex items-center gap-1">
          {entries.map((entry) => {
            const active = isActive(pathname, entry.to.route, { exact: false });
            return (
              <li key={entry.key}>
                <Link
                  to={entry.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-nav-active text-nav-active-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-chrome-subtle",
                  )}
                >
                  {t(entry.key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
