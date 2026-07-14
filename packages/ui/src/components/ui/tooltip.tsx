import { Tooltip as RadixTooltip } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Brand tooltip (ADR 0111) — an INK bubble: the near-black `nav-active` fill
 * floating on `shadow-float`, matching the toggled-control vocabulary so a hint
 * reads as chrome, not glass. Thin styled wrapper over radix-ui Tooltip;
 * `TooltipProvider` sets the shared (short) open delay and MUST wrap the app
 * once. Radix owns the tooltip context (a Trigger/Content rendered outside
 * `<Tooltip>` throws), so this stacks no parallel context to drift — it only
 * paints the brand tokens over the radix parts.
 */

/** Short, calm open delay — the brand "Seamless" feel (radix defaults to 700ms). */
const DEFAULT_DELAY_MS = 200;

/** App-root provider — configures the shared open delay for every tooltip. */
function TooltipProvider({
  delayDuration = DEFAULT_DELAY_MS,
  ...props
}: React.ComponentProps<typeof RadixTooltip.Provider>) {
  return <RadixTooltip.Provider delayDuration={delayDuration} {...props} />;
}

/** Per-tooltip root — pairs a trigger with its content. */
function Tooltip(props: React.ComponentProps<typeof RadixTooltip.Root>) {
  return <RadixTooltip.Root {...props} />;
}

/** The hoverable/focusable anchor — `asChild` to project onto any control. */
function TooltipTrigger(props: React.ComponentProps<typeof RadixTooltip.Trigger>) {
  return <RadixTooltip.Trigger data-slot="tooltip-trigger" {...props} />;
}

/** The ink bubble itself — portalled, with a matching filled arrow. */
function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-nav-active text-nav-active-foreground rounded-control shadow-float z-50 max-w-xs select-none px-2.5 py-1.5 text-xs",
          className,
        )}
        {...props}
      >
        {children}
        <RadixTooltip.Arrow data-slot="tooltip-arrow" className="text-nav-active fill-current" />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  );
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
