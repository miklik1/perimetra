import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Segmented control (ADR 0111) — a group of stadium pills, each an icon + label,
 * with exactly one active. Compound-with-context: <SegmentedNav value
 * onValueChange> puts the selection + setter on context and each
 * <SegmentedNavItem> reads it, so callers compose segments as children instead
 * of feeding an items array. The active pill flips to the near-black
 * `bg-nav-active` fill — the same toggle grammar as IconButton/StepNav — over an
 * optional recessed chrome track. Domain-agnostic: the caller owns the values,
 * the inline-svg icons and labels.
 *
 * What this is NOT: page navigation. It used to render a `<nav>` landmark and
 * mark the selected pill `aria-current="page"`, which is factually wrong for
 * every real use — a screen-reader user heard "Rozpad, current page" for a
 * control that changes no page, and the one product consumer had to re-state the
 * semantics by hand through the spread props. So the root is a NAMED
 * `role="group"` and each segment is a toggle button carrying `aria-pressed`
 * (always emitted, `true`/`false` — a toggle with a missing `aria-pressed` reads
 * as a plain button). The accessible name is REQUIRED by the prop type: an
 * unnamed group is an axe failure, and it is the only thing telling the user
 * what the segments are switching between.
 *
 * Deliberately not a `tablist` either: nothing here wires `tabpanel`s, and
 * `role="tab"` would additionally owe roving tabindex, arrow-key movement and
 * `aria-controls`. Real tabs are `tabs.tsx`. Here the native `<button>`s carry
 * their own keyboard operation (Tab to reach, Enter/Space to press).
 */

interface SegmentedNavContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const SegmentedNavContext = React.createContext<SegmentedNavContextValue | null>(null);

function useSegmentedNav(): SegmentedNavContextValue {
  const ctx = React.use(SegmentedNavContext);
  if (!ctx) {
    throw new Error("<SegmentedNavItem> must be used within <SegmentedNav>");
  }
  return ctx;
}

/**
 * The accessible name is part of the contract, not an optional extra, so it is
 * enforced by the type: one of `aria-label` / `aria-labelledby` must be present.
 * A union (rather than a single required prop) keeps the labelledby form — the
 * right one when a visible heading already names the group — equally first-class.
 */
type SegmentedNavName = { "aria-label": string } | { "aria-labelledby": string };

type SegmentedNavProps = React.ComponentProps<"div"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Wrap the pills in the recessed chrome track (default `true`). */
  track?: boolean;
} & SegmentedNavName;

function SegmentedNav({
  value,
  onValueChange,
  track = true,
  className,
  children,
  ...props
}: SegmentedNavProps) {
  return (
    <SegmentedNavContext value={{ value, onValueChange }}>
      <div
        data-slot="segmented-nav"
        role="group"
        className={cn(
          "inline-flex items-center gap-1",
          track && "bg-chrome shadow-soft-sm rounded-full p-1",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </SegmentedNavContext>
  );
}

interface SegmentedNavItemProps extends React.ComponentProps<"button"> {
  value: string;
  /** Inline svg supplied by the caller — sized to 16px unless it sets its own. */
  icon?: React.ReactNode;
  label: React.ReactNode;
}

function SegmentedNavItem({
  value,
  icon,
  label,
  className,
  onClick,
  ...props
}: SegmentedNavItemProps) {
  const { value: selected, onValueChange } = useSegmentedNav();
  const active = selected === value;
  return (
    <button
      type="button"
      data-slot="segmented-nav-item"
      data-active={active || undefined}
      aria-pressed={active}
      onClick={(event) => {
        onClick?.(event);
        // Selection is this control's core job — a caller onClick composes with
        // it (and can opt out with preventDefault), never silently clobbers it.
        if (!event.defaultPrevented) onValueChange(value);
      }}
      className={cn(
        "ease-brand inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium outline-none transition-colors duration-200",
        "focus-visible:ring-ring focus-visible:ring-2",
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        active
          ? "bg-nav-active text-nav-active-foreground shadow-soft-sm"
          : "text-muted-foreground hover:bg-chrome-subtle hover:text-foreground",
        className,
      )}
      {...props}
    >
      {icon}
      {label}
    </button>
  );
}

export { SegmentedNav, SegmentedNavItem };
