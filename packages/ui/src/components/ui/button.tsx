import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

const buttonVariants = cva(
  // Base grammar (ADR 0111): soft-geometry radius (`rounded-control`) + the brand
  // ease, so every button carries the "Seamless" motion. Ink default + copper
  // focus ring come from the retired-blue token change, no class needed here.
  "ease-brand inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium whitespace-nowrap transition-all duration-200 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        copper: "bg-copper text-copper-foreground shadow-soft hover:bg-copper-hover", // ADR 0072 — the one brand CTA accent
        "copper-outline":
          "border border-copper text-copper bg-transparent hover:bg-copper hover:text-copper-foreground", // ghost copper for secondary CTAs
      },
      // `pointer-coarse:` lifts heights/icon hit-area to the 44px WCAG 2.5.5
      // touch floor on touch devices ONLY, preserving desktop mouse density.
      // The same buttons render in mobile sheets/drawers. `xs`/`icon-xs` are
      // intentional micro-sizes (inline chips) — left untouched. (Channel-A
      // drain from fullstack-skeleton 93044ea.)
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3 pointer-coarse:min-h-11",
        xs: "h-6 gap-1 rounded-inset px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5 pointer-coarse:min-h-11",
        lg: "h-10 px-6 has-[>svg]:px-4 pointer-coarse:min-h-11",
        icon: "size-9 pointer-coarse:size-11",
        "icon-xs": "size-6 rounded-inset [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 pointer-coarse:size-11",
        "icon-lg": "size-10 pointer-coarse:size-11",
      },
      // Opt-in fully-rounded (stadium) shape — the Bombardier action-pill / nav
      // grammar. Default keeps the base `rounded-control`; `pill` wins via merge.
      shape: {
        default: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  shape = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, shape, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
