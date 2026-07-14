import { Checkbox as RadixCheckbox, Switch as RadixSwitch } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Brand toggle + checkbox on Radix (ADR 0111) — the two binary controls of the
 * kit, sharing one visual grammar: the `nav-active` near-black fill marks the
 * ON/checked state (same token as the active pill), a hairline `ring-border/60`
 * gives edge definition without a heavy border, and depth comes from the thumb's
 * `shadow-soft-sm`, never glass. Radix owns the behaviour + a11y (role, keyboard,
 * form bubble input); we only style the parts. Self-contained single components —
 * no compound context to leak — with `data-slot` on every part.
 */

function Switch({ className, ...props }: React.ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      data-slot="switch"
      className={cn(
        "ease-brand ring-border/60 focus-visible:ring-ring data-[state=checked]:bg-nav-active data-[state=unchecked]:bg-muted inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full px-0.5 outline-none ring-1 ring-inset transition-colors duration-200 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb
        data-slot="switch-thumb"
        className="ease-brand bg-chrome shadow-soft-sm pointer-events-none block size-5 rounded-full transition-transform duration-200 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      />
    </RadixSwitch.Root>
  );
}

function Checkbox({ className, ...props }: React.ComponentProps<typeof RadixCheckbox.Root>) {
  return (
    <RadixCheckbox.Root
      data-slot="checkbox"
      className={cn(
        "ease-brand rounded-inset bg-chrome-subtle ring-border/60 focus-visible:ring-ring data-[state=checked]:bg-nav-active data-[state=checked]:text-nav-active-foreground inline-flex size-5 shrink-0 cursor-pointer items-center justify-center outline-none ring-1 ring-inset transition-colors duration-200 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator
        data-slot="checkbox-indicator"
        className="group inline-flex items-center justify-center"
      >
        {/* Radix mounts the indicator for BOTH checked and indeterminate; the
            glyph swaps off the part's own data-state so a mixed state reads as a
            dash, never a false check. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-3.5 group-data-[state=indeterminate]:hidden"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="hidden size-3.5 group-data-[state=indeterminate]:block"
        >
          <path d="M6 12h12" />
        </svg>
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}

export { Switch, Checkbox };
