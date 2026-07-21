"use client";

import { useState } from "react";

import { useTranslations } from "@repo/i18n/web";
import { Link } from "@repo/navigation";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@repo/ui";

import type { NavEntry } from "../../lib/nav-registry";
import { NavRowLink } from "./nav-link";

/**
 * Mobile (<768 px) — the top app bar (§4.4). Brand wordmark plus the footer group
 * (Nastavení / Platforma) collapsed behind an initials AVATAR button — the main
 * group is the bottom tab bar, so this menu is the escape affordance to
 * settings/platform that §4.4 requires at every breakpoint. Closes on selection.
 *
 * §4.4 names this the "avatar button". We render the account initial rather than
 * a real profile image — no avatar-image data model exists yet — recorded as an
 * ADR 0118 §11.2 interim.
 */
export function MobileTopBar({
  entries,
  pathname,
  userLabel,
  className,
}: {
  entries: readonly NavEntry[];
  pathname: string;
  userLabel?: string;
  className?: string;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const footer = entries.filter((e) => e.group === "footer");
  const initial = userLabel?.trim().charAt(0).toUpperCase() || "•";
  return (
    <header
      data-testid="app-mobile-topbar"
      className={cn(
        "border-border bg-chrome h-14 shrink-0 items-center justify-between border-b px-4",
        className,
      )}
    >
      <Link
        to={{ route: "home" }}
        className="font-display rounded-control focus-visible:ring-ring -mx-1 flex h-11 items-center px-1 text-lg font-semibold tracking-tight outline-none focus-visible:ring-2"
      >
        Perimetra
      </Link>
      {footer.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("menu")}
              className="rounded-control focus-visible:ring-ring flex h-11 w-11 items-center justify-center outline-none focus-visible:ring-2"
            >
              <span
                aria-hidden
                className="bg-nav-active text-nav-active-foreground flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
              >
                {initial}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <nav aria-label={t("menu")} className="flex flex-col gap-0.5">
              {footer.map((entry) => (
                <NavRowLink
                  key={entry.key}
                  entry={entry}
                  pathname={pathname}
                  label={t(entry.key)}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </nav>
          </PopoverContent>
        </Popover>
      )}
    </header>
  );
}
