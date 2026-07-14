import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Segmented top-nav (ADR 0111) — a group of stadium pills, each an icon + label,
 * with one active. Compound-with-context: <SegmentedNav value onValueChange>
 * puts the selection + setter on context and each <SegmentedNavItem> reads it,
 * so callers compose sections as children instead of feeding an items array.
 * The active pill flips to the near-black `bg-nav-active` fill — the same
 * toggle grammar as IconButton/StepNav — over an optional recessed chrome track.
 * Domain-agnostic: the caller owns the values, the inline-svg icons and labels.
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

interface SegmentedNavProps extends React.ComponentProps<"nav"> {
  value: string;
  onValueChange: (value: string) => void;
  /** Wrap the pills in the recessed chrome track (default `true`). */
  track?: boolean;
}

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
      <nav
        data-slot="segmented-nav"
        className={cn(
          "inline-flex items-center gap-1",
          track && "bg-chrome shadow-soft-sm rounded-full p-1",
          className,
        )}
        {...props}
      >
        {children}
      </nav>
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
      aria-current={active ? "page" : undefined}
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
