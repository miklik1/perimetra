import { Tabs as RadixTabs } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Pill tabs (ADR 0111) — the SegmentedNav grammar promoted to real tab
 * semantics + panels. A recessed chrome track holds pill triggers; the active
 * pill flips to the near-black `bg-nav-active` fill (mirroring StepNav/IconButton
 * so a selected tab reads at a glance). Behaviour — roving tabindex, arrow-key
 * nav, ARIA wiring, and the used-outside-`<Tabs>` throw — is Radix's context;
 * we stack no redundant one and only paint the brand tokens over its parts.
 */

function Tabs({ className, ...props }: React.ComponentProps<typeof RadixTabs.Root>) {
  return <RadixTabs.Root data-slot="tabs" className={cn(className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      data-slot="tabs-list"
      className={cn(
        "bg-chrome shadow-soft-sm inline-flex items-center gap-1 rounded-full p-1",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "ease-brand text-muted-foreground rounded-full px-4 py-1.5 text-sm font-medium outline-none transition-colors duration-200",
        "hover:text-foreground focus-visible:ring-ring focus-visible:ring-2",
        "data-[state=active]:bg-nav-active data-[state=active]:text-nav-active-foreground data-[state=active]:shadow-soft-sm",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content
      data-slot="tabs-content"
      className={cn(
        "rounded-card focus-visible:ring-ring mt-4 outline-none focus-visible:ring-2",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
