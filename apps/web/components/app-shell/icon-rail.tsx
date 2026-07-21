"use client";

import { useTranslations } from "@repo/i18n/web";
import { Link } from "@repo/navigation";
import { cn, Icon, Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui";

import { isNavEntryActive, type NavEntry } from "../../lib/nav-registry";

/**
 * Tablet (768–1279 px) — the 68 px icon rail (§4.4). Glyph only; the label is
 * the control's `aria-label` AND a real `Tooltip` (never the native `title`,
 * which is invisible to keyboard/touch — §4.4 / §12.2). Targets are 44 px
 * (`h-11 w-11`, §12.5). The rail is ALWAYS present at this breakpoint — a canvas
 * frame dropped it at 1024 px and stranded the user; that a11y defect is not
 * reproduced here.
 */
export function IconRail({
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
      data-testid="app-icon-rail"
      aria-label={t("main")}
      className={cn(
        "border-border bg-chrome w-[68px] shrink-0 flex-col items-center border-r",
        className,
      )}
    >
      <Link
        to={{ route: "home" }}
        aria-label="Perimetra"
        className="font-display rounded-control focus-visible:ring-ring mx-auto flex h-14 w-11 shrink-0 items-center justify-center text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        P
      </Link>
      <ul className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
        {main.map((entry) => (
          <li key={entry.key}>
            <IconRailLink entry={entry} pathname={pathname} label={t(entry.key)} />
          </li>
        ))}
      </ul>
      {footer.length > 0 && (
        <ul className="border-border flex shrink-0 flex-col items-center gap-1 border-t py-2">
          {footer.map((entry) => (
            <li key={entry.key}>
              <IconRailLink entry={entry} pathname={pathname} label={t(entry.key)} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function IconRailLink({
  entry,
  pathname,
  label,
}: {
  entry: NavEntry;
  pathname: string;
  label: string;
}) {
  const active = isNavEntryActive(pathname, entry);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={entry.to}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "rounded-control focus-visible:ring-ring flex h-11 w-11 items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
            active
              ? "bg-nav-active text-nav-active-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-chrome-subtle",
          )}
        >
          <Icon name={entry.icon} size={20} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
