"use client";

import { useTranslations } from "@repo/i18n/web";
import { cn } from "@repo/ui";

import type { NavEntry } from "../../lib/nav-registry";

/** The counts map the shell threads to every rail — `{leads?, quotes?, orders?}`
 *  (`GET /v1/me/nav-counts`, 1c-3). An absent key means "no pill", never 0. */
export type NavCounts = Partial<Record<NonNullable<NavEntry["countKey"]>, number>>;

/** The count to badge on `entry`, or `undefined` when it carries no pill source
 *  or the source is absent/zero — an empty pill is worse than none (§4.1). */
export function navCountFor(entry: NavEntry, counts: NavCounts): number | undefined {
  if (!entry.countKey) return undefined;
  const value = counts[entry.countKey];
  return value && value > 0 ? value : undefined;
}

/** Cap the visible glyph so a runaway count never blows out the rail width. */
function formatCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/**
 * A count badge (1c-3), matched to the design's per-density spec (§4.4):
 *  - `inline`  — a labelled pill at the end of a row (side rail; `ml-auto` pushes
 *                it right). Number + announced.
 *  - `corner`  — a superscript numeric badge on a glyph-only control (icon rail;
 *                the parent must be `relative`).
 *  - `dot`     — a bare presence dot on a glyph (mobile tab bar — §4.4 wants a dot,
 *                not a number, at this breakpoint). No visible digit.
 *
 * The real count always rides `aria-label` (ICU-pluralised) UNLESS `decorative`
 * is set — the icon-rail glyph link owns an explicit `aria-label`, which per the
 * accessible-name algorithm suppresses any descendant's name, so there the count
 * is folded into the LINK's label instead and the badge is marked decorative to
 * avoid a dead, un-announced label. Everywhere else (side rail, tab bar) the
 * link has no `aria-label`, so name-from-content picks up this badge's — a screen
 * reader announces e.g. "Zakázky, 5 nových položek" even when the glyph is a dot
 * or a capped "99+".
 */
export function NavBadge({
  count,
  placement,
  decorative = false,
  className,
}: {
  count: number;
  placement: "inline" | "corner" | "dot";
  decorative?: boolean;
  className?: string;
}) {
  const t = useTranslations("nav");
  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { "aria-label": t("badge", { count }) };

  if (placement === "dot") {
    return (
      <span
        {...a11y}
        className={cn("bg-primary absolute -top-0.5 right-0 size-2 rounded-full", className)}
      />
    );
  }
  return (
    <span
      {...a11y}
      className={cn(
        "bg-primary text-primary-foreground inline-flex items-center justify-center rounded-full font-semibold tabular-nums",
        placement === "inline"
          ? "ml-auto h-5 min-w-5 px-1.5 text-[0.625rem]"
          : "pointer-events-none absolute -top-1 right-0 h-4 min-w-4 px-1 text-[0.5625rem]",
        className,
      )}
    >
      {formatCount(count)}
    </span>
  );
}
