import { Popover as RadixPopover } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Brand popover (ADR 0111) — a floating panel anchored to its trigger, built on
 * radix so focus management, outside-dismiss, and Popper positioning come free.
 * Skinned to the flat-matte chrome depth model: matte chrome floated by
 * `shadow-float` over a hairline inset ring, never glass. A private marker
 * context makes a mis-nested `PopoverTrigger`/`PopoverContent`/`PopoverClose`
 * fail LOUD and BRANDED ("… within <Popover>") instead of surfacing radix's
 * internal error — the same guard every sibling radix wrapper carries.
 */

// A marker context so a styled part fails LOUD and BRANDED ("… within <Popover>")
// when composed outside the Root, instead of surfacing Radix's internal error.
const PopoverContext = React.createContext(false);

function usePopoverScope(part: string): void {
  if (!React.use(PopoverContext)) {
    throw new Error(`\`${part}\` must be used within <Popover>.`);
  }
}

/** Compound root — provides Radix's Popover context (no DOM of its own). */
function Popover(props: React.ComponentProps<typeof RadixPopover.Root>) {
  return (
    <PopoverContext value={true}>
      <RadixPopover.Root {...props} />
    </PopoverContext>
  );
}

function PopoverTrigger(props: React.ComponentProps<typeof RadixPopover.Trigger>) {
  usePopoverScope("PopoverTrigger");
  return <RadixPopover.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof RadixPopover.Content>) {
  usePopoverScope("PopoverContent");
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        data-slot="popover-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-chrome text-chrome-foreground rounded-card shadow-float ring-border/60 z-50 p-4 outline-none ring-1 ring-inset",
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}

function PopoverClose(props: React.ComponentProps<typeof RadixPopover.Close>) {
  usePopoverScope("PopoverClose");
  return <RadixPopover.Close data-slot="popover-close" {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverClose };
