import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Pill step-navigation (ADR 0072) — the centered, soft-geometry wizard bar:
 * the active step is a near-black fill (`bg-nav-active`), completed/reachable
 * steps are quiet hover-pills, and steps past `maxReachable` stay inert
 * (sequential-forward, free-back — the Bombardier grammar). Controlled and
 * domain-agnostic: labels/ids come from the caller (a release UiSpec, the
 * brand flow, anything).
 */
export interface StepNavItem {
  id: string;
  label: string;
}

export interface StepNavProps {
  steps: StepNavItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Highest index the user may jump to (forward steps beyond it are inert).
   *  Default: every step reachable. */
  maxReachable?: number;
  className?: string;
  "aria-label"?: string;
}

function StepNav({
  steps,
  activeIndex,
  onSelect,
  maxReachable = steps.length - 1,
  className,
  "aria-label": ariaLabel,
}: StepNavProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn("flex flex-wrap items-center justify-center gap-1.5", className)}
    >
      {steps.map((step, i) => {
        const active = i === activeIndex;
        const reachable = i <= maxReachable;
        return (
          <button
            key={step.id}
            type="button"
            data-slot="step-nav-item"
            data-active={active || undefined}
            aria-current={active ? "step" : undefined}
            disabled={!reachable}
            onClick={() => reachable && onSelect(i)}
            className={cn(
              "ease-brand rounded-full px-4 py-1.5 text-sm font-medium outline-none transition-colors duration-200",
              "focus-visible:ring-ring focus-visible:ring-2",
              active
                ? "bg-nav-active text-nav-active-foreground shadow-soft"
                : reachable
                  ? "text-muted-foreground hover:bg-chrome-subtle hover:text-foreground"
                  : "text-muted-foreground/50 cursor-not-allowed",
            )}
          >
            {step.label}
          </button>
        );
      })}
    </nav>
  );
}

export { StepNav };
