import { Separator as RadixSeparator } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Loading + division primitives (ADR 0111). Three small, presentational parts
 * sharing the kit's token grammar: `Skeleton` is a `bg-muted` pulse box sized by
 * the caller's className; `Spinner` is an inline `currentColor` arc (a `status`
 * region with a Czech default label); `Separator` is the Radix rule styled to a
 * `bg-border` hairline. No compound context — each is self-contained, with a
 * `data-slot` on every part.
 */

/** Content placeholder — has no intrinsic size; the caller's className sizes it. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-control bg-muted animate-pulse", className)}
      {...props}
    />
  );
}

/**
 * Inline indeterminate spinner — a single `currentColor` arc so it inherits ink
 * from its context; `role="status"` + a Czech default label make it announce,
 * both overridable through props. Size via `className` (default `size-4`).
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      role="status"
      aria-label="Načítání"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
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
