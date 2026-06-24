import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Small pill label / count badge (ADR 0072). The `deviation` tone is the
 * CORE_SPEC §6 signal carried into the UI layer — kept on its OWN token
 * (--color-deviation, amber) so it never aliases the copper UI accent.
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide tabular-nums uppercase",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        copper: "bg-copper text-copper-foreground",
        deviation: "bg-deviation text-deviation-foreground",
        outline: "text-muted-foreground border border-border",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone, className }))} {...props} />;
}

export { Badge, badgeVariants };
