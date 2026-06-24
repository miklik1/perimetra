import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Flat-matte chrome surface (ADR 0072) — the Bombardier-derived depth model:
 * a matte white card lifted off the warm-grey field by a SOFT SHADOW, never
 * glass. Three flat planes, depth from elevation only. Token-driven (bg-chrome
 * + shadow-soft), so the whole brand shifts from `theme.css` alone.
 */
const panelVariants = cva("rounded-2xl bg-chrome text-chrome-foreground", {
  variants: {
    elevation: {
      flat: "shadow-soft",
      raised: "shadow-soft-lg",
      flush: "bg-chrome-subtle",
    },
    padded: {
      true: "p-5",
      false: "",
    },
  },
  defaultVariants: {
    elevation: "flat",
    padded: true,
  },
});

function Panel({
  className,
  elevation,
  padded,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof panelVariants>) {
  return (
    <div
      data-slot="panel"
      className={cn(panelVariants({ elevation, padded, className }))}
      {...props}
    />
  );
}

export { Panel, panelVariants };
