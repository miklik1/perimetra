import { Separator as RadixSeparator } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Loading + division primitives (ADR 0111). Three small, presentational parts
 * sharing the kit's token grammar: `Skeleton` is a `bg-muted` pulse box sized by
 * the caller's className; `Spinner` is an inline `currentColor` arc (decorative
 * by default, see below); `Separator` is the Radix rule styled to a `bg-border`
 * hairline. No compound context — each is self-contained, with a `data-slot` on
 * every part.
 */

/** Content placeholder — has no intrinsic size; the caller's className sizes it. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-control bg-muted animate-pulse motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

/**
 * Inline indeterminate spinner — a single `currentColor` arc so it inherits ink
 * from its context. Size via `className` (default `size-4`).
 *
 * Accessibility: the spinner is DECORATIVE by default (`aria-hidden`), because a
 * loading indicator almost always sits beside its own visible text — and because
 * a hardcoded `role="status"` announced nothing anyway: a live region announces
 * CONTENT CHANGES, and this SVG mounts with its label and never mutates. Where
 * the spinner IS the only loading signal, the caller passes `aria-label` /
 * `aria-labelledby` and it flips to a real `status` region. That is derived from
 * the prop rather than taking a `decorative` boolean, so the two can never
 * contradict each other — the same rule (and the same shape) as `Icon`.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;

  return (
    <svg
      data-slot="spinner"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      role={labelled ? "status" : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn("text-muted-foreground size-4 animate-spin", className)}
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * Hairline rule on Radix Separator — decorative by default; pass `decorative={false}`
 * for a semantic separator. Orientation flows to the token-driven h/w rule.
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof RadixSeparator.Root>) {
  return (
    <RadixSeparator.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton, Spinner, Separator };
