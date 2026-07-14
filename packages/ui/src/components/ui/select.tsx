import { Select as RadixSelect } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Branded dropdown (ADR 0111) — the recessed-chrome control vocabulary applied
 * to Radix Select. The trigger reads as an INPUT (matte `bg-chrome-subtle` well
 * behind a hairline ring), the listbox as a floating chrome card (`shadow-float`,
 * the no-glass depth model), and the copper check marks the selected row — the
 * one accent, used sparingly. Compound: `<Select>` is the Radix Root; the styled
 * parts are thin token wrappers that keep Radix's keyboard/a11y behavior intact.
 */

// A marker context so a styled part fails LOUD and BRANDED ("… within <Select>")
// when composed outside the Root, instead of surfacing Radix's internal error.
const SelectContext = React.createContext(false);

function useSelectScope(part: string): void {
  const inside = React.use(SelectContext);
  if (!inside) {
    throw new Error(`\`${part}\` must be used within <Select>.`);
  }
}

/** Compound root — provides Radix's Select context (no DOM of its own). */
function Select({ children, ...props }: React.ComponentProps<typeof RadixSelect.Root>) {
  return (
    <SelectContext value={true}>
      <RadixSelect.Root {...props}>{children}</RadixSelect.Root>
    </SelectContext>
  );
}

/** The input-like trigger, chevron in the Radix Icon slot. */
function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixSelect.Trigger>) {
  useSelectScope("SelectTrigger");
  return (
    <RadixSelect.Trigger
      data-slot="select-trigger"
      className={cn(
        "ease-brand bg-chrome-subtle text-chrome-foreground ring-border/60 focus-visible:ring-ring data-[placeholder]:text-muted-foreground rounded-control inline-flex items-center justify-between gap-2 px-3 py-2 text-sm outline-none ring-1 ring-inset transition-[color,box-shadow] duration-200 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <RadixSelect.Icon className="text-muted-foreground shrink-0">
        <ChevronDownIcon className="size-4" />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

/** Selected-value / placeholder text inside the trigger. */
function SelectValue(props: React.ComponentProps<typeof RadixSelect.Value>) {
  useSelectScope("SelectValue");
  return <RadixSelect.Value data-slot="select-value" {...props} />;
}

/** Floating chrome listbox — portalled, popper-anchored under the trigger. */
function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof RadixSelect.Content>) {
  useSelectScope("SelectContent");
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        data-slot="select-content"
        position={position}
        sideOffset={sideOffset}
        className={cn(
          "bg-chrome text-chrome-foreground ring-border/60 shadow-float rounded-card z-50 max-h-[var(--radix-select-content-available-height)] min-w-[8rem] overflow-hidden p-1 ring-1 ring-inset",
          className,
        )}
        {...props}
      >
        <RadixSelect.Viewport
          className={cn(
            position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

/** A selectable row; the copper check occupies the Radix ItemIndicator slot. */
function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixSelect.Item>) {
  useSelectScope("SelectItem");
  return (
    <RadixSelect.Item
      data-slot="select-item"
      className={cn(
        "ease-brand data-[highlighted]:bg-chrome-subtle rounded-inset relative flex cursor-default select-none items-center justify-between gap-2 px-2 py-1.5 text-sm outline-none transition-colors duration-200 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="text-copper shrink-0">
        <CheckIcon className="size-4" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

function ChevronDownIcon({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function CheckIcon({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="m3.5 8.5 3 3 6-6" />
    </svg>
  );
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
