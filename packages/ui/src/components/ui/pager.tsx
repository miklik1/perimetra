import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Circular prev/next pager (ADR 0111) — reuses the IconButton chrome grammar
 * (a matte-white circle on a soft shadow) as a single, fully-controlled stepper
 * for paged surfaces (quote revisions, drawing sheets, wizard steps). The parent
 * owns the index and the can-step edges; an optional `font-data` center label
 * reads the position at a glance ("2 / 4"). No radix — two plain buttons.
 */

const pagerButton = cn(
  "bg-chrome text-chrome-foreground shadow-soft grid size-9 place-items-center rounded-full",
  "transition-colors duration-200 ease-brand hover:bg-chrome-subtle",
  "outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
);

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

type PagerProps = React.ComponentProps<"div"> & {
  onPrev: () => void;
  onNext: () => void;
  /** Step-back edge — disables the prev button. */
  canPrev?: boolean;
  /** Step-forward edge — disables the next button. */
  canNext?: boolean;
  /** Optional center readout, e.g. "2 / 4". Hidden when omitted. */
  label?: React.ReactNode;
  prevLabel?: string;
  nextLabel?: string;
};

function Pager({
  onPrev,
  onNext,
  canPrev = true,
  canNext = true,
  label,
  prevLabel = "Předchozí",
  nextLabel = "Další",
  className,
  ...props
}: PagerProps) {
  return (
    <div data-slot="pager" className={cn("inline-flex items-center gap-2", className)} {...props}>
      <button
        type="button"
        data-slot="pager-prev"
        aria-label={prevLabel}
        onClick={onPrev}
        disabled={!canPrev}
        className={pagerButton}
      >
        <ChevronLeftIcon />
      </button>
      {label != null ? (
        <span
          data-slot="pager-label"
          className="font-data text-muted-foreground select-none text-sm tabular-nums"
        >
          {label}
        </span>
      ) : null}
      <button
        type="button"
        data-slot="pager-next"
        aria-label={nextLabel}
        onClick={onNext}
        disabled={!canNext}
        className={pagerButton}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

export { Pager };
