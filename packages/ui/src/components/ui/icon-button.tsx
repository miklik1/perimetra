import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Circular icon-button (ADR 0072) — the soft-geometry control vocabulary: a
 * matte-white circle on a soft shadow that, stacked, forms the 3D viewport's
 * control cluster (view presets, section toggle, deviation toggle). `active`
 * flips it to the near-black fill so a toggled state reads at a glance.
 */
const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      size: {
        sm: "size-8 [&_svg:not([class*='size-'])]:size-4",
        md: "size-9 [&_svg:not([class*='size-'])]:size-[18px]",
        lg: "size-11 [&_svg:not([class*='size-'])]:size-5",
      },
      active: {
        true: "bg-nav-active text-nav-active-foreground shadow-soft",
        false: "bg-chrome text-chrome-foreground shadow-soft hover:bg-chrome-subtle",
      },
    },
    defaultVariants: {
      size: "md",
      active: false,
    },
  },
);

function IconButton({
  className,
  size,
  active,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof iconButtonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="icon-button"
      data-active={active || undefined}
      className={cn(iconButtonVariants({ size, active, className }))}
      {...props}
    />
  );
}

/** Vertical (default) cluster wrapper — the floating viewport control stack. */
function IconCluster({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  return (
    <div
      data-slot="icon-cluster"
      className={cn("flex gap-2", orientation === "vertical" ? "flex-col" : "flex-row", className)}
      {...props}
    />
  );
}

export { IconButton, IconCluster, iconButtonVariants };
