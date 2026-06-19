import { Collapsible } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * A single collapsible section (radix Collapsible) for nested editor blocks —
 * a parameter's `deviation`/`domain`, a part's `resolve`/`bom`/`geometry`. The
 * trigger shows the title + an optional badge (e.g. a defect count); the chevron
 * rotates with the open state via `data-state` on the trigger.
 */
export interface DisclosureSectionProps {
  title: React.ReactNode;
  /** Trailing slot in the header — typically a defect-count badge. */
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function DisclosureSection({
  title,
  badge,
  defaultOpen = false,
  className,
  children,
}: DisclosureSectionProps) {
  return (
    <Collapsible.Root
      defaultOpen={defaultOpen}
      className={cn("border-border rounded-md border", className)}
      data-slot="disclosure"
    >
      <Collapsible.Trigger className="hover:bg-accent group flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
          >
            ›
          </span>
          {title}
        </span>
        {badge}
      </Collapsible.Trigger>
      <Collapsible.Content className="border-border border-t px-3 py-3">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
