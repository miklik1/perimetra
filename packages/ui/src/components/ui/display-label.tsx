import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Editorial display-scale label (ADR 0072) — the publication-hierarchy step
 * title (sentence case, light weight, tight tracking) that carries the premium
 * register. Scales 36 → 60 → 96px so it never overflows a narrow viewport.
 * The display step (`text-display`) is a `theme.css` type-scale token.
 */
function DisplayLabel({
  className,
  as: Comp = "h2",
  ...props
}: React.ComponentProps<"h2"> & { as?: "h1" | "h2" | "p" | "span" }) {
  return (
    <Comp
      data-slot="display-label"
      className={cn(
        "text-foreground md:text-display text-4xl font-light tracking-tight sm:text-6xl",
        className,
      )}
      {...props}
    />
  );
}

export { DisplayLabel };
