import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Steel-blue SPOTLIGHT metric card (ADR 0111) — the hero/summary surface, the
 * ONE place `bg-spotlight` is spent. Compound slots (Metric/Label/Title/
 * Subtitle/Action/Media) share the card's white ink by CSS nesting, not by
 * prop-drilling: the root sets `text-spotlight-foreground` and every child
 * inherits it. The context here is a COMPOSITION GUARD only — it carries no
 * value, it just makes a stray `<StatCard.Metric>` throw instead of rendering
 * unstyled outside its card.
 */
const StatCardContext = React.createContext<boolean>(false);

function useStatCardGuard(part: string): void {
  if (!React.use(StatCardContext)) {
    throw new Error(`<StatCard.${part}> must be rendered inside <StatCard>.`);
  }
}

function StatCardRoot({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <StatCardContext value={true}>
      <div
        data-slot="stat-card"
        className={cn(
          "relative rounded-card-lg bg-spotlight p-5 text-spotlight-foreground shadow-soft",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </StatCardContext>
  );
}

/** The big numeral — Amulya data face at the metric scale. */
function StatCardMetric({ className, ...props }: React.ComponentProps<"div">) {
  useStatCardGuard("Metric");
  return (
    <div
      data-slot="stat-card-metric"
      className={cn("font-data text-metric leading-none", className)}
      {...props}
    />
  );
}

/** Small caption sitting under/over the metric (or the title). */
function StatCardLabel({ className, ...props }: React.ComponentProps<"span">) {
  useStatCardGuard("Label");
  return (
    <span data-slot="stat-card-label" className={cn("text-sm opacity-80", className)} {...props} />
  );
}

/** The card's display heading (Chillax). */
function StatCardTitle({ className, ...props }: React.ComponentProps<"div">) {
  useStatCardGuard("Title");
  return (
    <div
      data-slot="stat-card-title"
      className={cn("font-display text-title", className)}
      {...props}
    />
  );
}

/** The muted line under the title. */
function StatCardSubtitle({ className, ...props }: React.ComponentProps<"div">) {
  useStatCardGuard("Subtitle");
  return (
    <div
      data-slot="stat-card-subtitle"
      className={cn("text-sm opacity-80", className)}
      {...props}
    />
  );
}

/**
 * Circular affordance in the top-right corner (the ↗ open/expand control). A
 * translucent chip tinted from the card's own `spotlight-foreground` ink (a
 * semantic scrim, never raw white) so it reads on the spotlight fill and shifts
 * with the theme; `aria-label` is the caller's responsibility since the glyph
 * is the only content.
 */
function StatCardAction({ className, ...props }: React.ComponentProps<"button">) {
  useStatCardGuard("Action");
  return (
    <button
      type="button"
      data-slot="stat-card-action"
      className={cn(
        "absolute top-4 right-4 grid size-9 place-items-center rounded-full bg-spotlight-foreground/15 transition-colors duration-200 ease-brand outline-none hover:bg-spotlight-foreground/25 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** Centered slot for a small image / rendered thumbnail. */
function StatCardMedia({ className, ...props }: React.ComponentProps<"div">) {
  useStatCardGuard("Media");
  return (
    <div
      data-slot="stat-card-media"
      className={cn("grid place-items-center", className)}
      {...props}
    />
  );
}

const StatCard = Object.assign(StatCardRoot, {
  Metric: StatCardMetric,
  Label: StatCardLabel,
  Title: StatCardTitle,
  Subtitle: StatCardSubtitle,
  Action: StatCardAction,
  Media: StatCardMedia,
});

export { StatCard };
