"use client";

import { useTranslations } from "@repo/i18n/web";
import { Link } from "@repo/navigation";
import { cn, Icon } from "@repo/ui";

import { isNavEntryActive, type NavEntry } from "../../lib/nav-registry";

/**
 * Mobile (<768 px) — the bottom tab bar (§4.4). MAIN group only, capped at five
 * by the registry (workshop → 2, admin/sales → 5), so it never overflows and
 * never needs a "More" tab; the footer group lives behind the top-bar menu.
 * Copper active state; 44 px targets (§12.5); the bottom padding clears the
 * home-indicator safe area.
 */
export function TabBar({
  entries,
  pathname,
  className,
}: {
  entries: readonly NavEntry[];
  pathname: string;
  className?: string;
}) {
  const t = useTranslations("nav");
  const main = entries.filter((e) => e.group === "main");
  return (
    <nav
      data-testid="app-tab-bar"
      aria-label={t("main")}
      className={cn(
        "border-border bg-chrome shrink-0 items-stretch justify-around gap-1 border-t px-2 pb-[calc(0.375rem+env(safe-area-inset-bottom))] pt-1.5",
        className,
      )}
    >
      {main.map((entry) => {
        const active = isNavEntryActive(pathname, entry);
        return (
          <Link
            key={entry.key}
            to={entry.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-control focus-visible:ring-ring flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[0.6875rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon name={entry.icon} size={22} />
            <span className="max-w-full truncate">{t(entry.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
