"use client";

import { useTranslations } from "@repo/i18n/web";
import { Link } from "@repo/navigation";
import { cn } from "@repo/ui";

import type { NavEntry } from "../../lib/nav-registry";
import { NavRowLink } from "./nav-link";

/**
 * Desktop (≥1280 px) — the 220 px labelled rail (§4.4). Main group scrolls; the
 * footer group (Platforma above Nastavení) is pinned to the bottom by
 * `margin-top: auto` on the spacer, i.e. the main `<ul>` taking `flex-1`.
 */
export function SideRail({
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
  const footer = entries.filter((e) => e.group === "footer");
  return (
    <nav
      data-testid="app-side-rail"
      aria-label={t("main")}
      className={cn("border-border bg-chrome w-[220px] shrink-0 flex-col border-r", className)}
    >
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link to={{ route: "home" }} className="font-display text-lg font-semibold tracking-tight">
          Perimetra
        </Link>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {main.map((entry) => (
          <li key={entry.key}>
            <NavRowLink entry={entry} pathname={pathname} label={t(entry.key)} />
          </li>
        ))}
      </ul>
      {footer.length > 0 && (
        <ul className="border-border flex shrink-0 flex-col gap-0.5 border-t px-3 py-2">
          {footer.map((entry) => (
            <li key={entry.key}>
              <NavRowLink entry={entry} pathname={pathname} label={t(entry.key)} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
