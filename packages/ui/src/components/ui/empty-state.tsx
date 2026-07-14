import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Empty-state surface (ADR 0111) — the "nothing here yet" placeholder: a
 * centered column of a muted chrome icon badge, a display title, a hint line
 * and an optional action. Presentational compound slots (Icon/Title/
 * Description/Action) that the caller composes as children — the copy, the
 * inline-svg glyph and the CTA all stay app-land. Like StatCard, the context
 * here is a COMPOSITION GUARD only: it carries no value, it just makes a stray
 * `<EmptyState.Title>` throw instead of rendering unstyled outside its root.
 */
const EmptyStateContext = React.createContext<boolean>(false);

function useEmptyStateGuard(part: string): void {
  if (!React.use(EmptyStateContext)) {
    throw new Error(`<EmptyState.${part}> must be rendered inside <EmptyState>.`);
  }
}

function EmptyStateRoot({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <EmptyStateContext value={true}>
      <div
        data-slot="empty-state"
        className={cn("flex flex-col items-center gap-3 py-12 text-center", className)}
        {...props}
      >
        {children}
      </div>
    </EmptyStateContext>
  );
}

/** Muted circular chrome badge wrapping the caller's inline svg (defaults it to 24px). */
function EmptyStateIcon({ className, ...props }: React.ComponentProps<"div">) {
  useEmptyStateGuard("Icon");
  return (
    <div
      data-slot="empty-state-icon"
      className={cn(
        "bg-chrome-subtle text-muted-foreground grid size-12 place-items-center rounded-full",
        "[&_svg:not([class*='size-'])]:size-6 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function EmptyStateTitle({ className, ...props }: React.ComponentProps<"p">) {
  useEmptyStateGuard("Title");
  return (
    <p
      data-slot="empty-state-title"
      className={cn("font-display text-title", className)}
      {...props}
    />
  );
}

function EmptyStateDescription({ className, ...props }: React.ComponentProps<"p">) {
  useEmptyStateGuard("Description");
  return (
    <p
      data-slot="empty-state-description"
      className={cn("text-muted-foreground max-w-sm text-sm", className)}
      {...props}
    />
  );
}

/** Spacing slot for a single CTA — drop a <Button> in as its child. */
function EmptyStateAction({ className, ...props }: React.ComponentProps<"div">) {
  useEmptyStateGuard("Action");
  return <div data-slot="empty-state-action" className={cn("mt-2", className)} {...props} />;
}

const EmptyState = Object.assign(EmptyStateRoot, {
  Icon: EmptyStateIcon,
  Title: EmptyStateTitle,
  Description: EmptyStateDescription,
  Action: EmptyStateAction,
});

export { EmptyState };
