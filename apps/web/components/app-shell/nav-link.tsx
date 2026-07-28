"use client";

import { Link } from "@repo/navigation";
import { cn, Icon } from "@repo/ui";

import { isNavEntryActive, type NavEntry } from "../../lib/nav-registry";
import { NavBadge } from "./nav-badge";

/**
 * A labelled navigation row — glyph + label + an optional count pill (1c-3),
 * active styling from the shared `isNavEntryActive` (so a detail screen keeps
 * its section lit). Shared by the desktop `SideRail` and the mobile top-bar
 * overflow menu; the icon rail and tab bar render their own denser variants.
 * `onNavigate` lets a container (the mobile menu popover) close on selection.
 */
export function NavRowLink({
  entry,
  pathname,
  label,
  count,
  onNavigate,
}: {
  entry: NavEntry;
  pathname: string;
  label: string;
  count?: number;
  onNavigate?: () => void;
}) {
  const active = isNavEntryActive(pathname, entry);
  return (
    <Link
      to={entry.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active
          ? "bg-nav-active text-nav-active-foreground"
          : "text-muted-foreground hover:bg-chrome-subtle hover:text-foreground",
      )}
    >
      <Icon name={entry.icon} size={18} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <NavBadge count={count} placement="inline" />}
    </Link>
  );
}
