import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Flat-matte chrome surface (ADR 0072) — the Bombardier-derived depth model:
 * a matte white card lifted off the warm-grey field by a SOFT SHADOW, never
 * glass. Three flat planes, depth from elevation only. Token-driven (bg-chrome
 * + shadow-soft), so the whole brand shifts from `theme.css` alone.
 */
const panelVariants = cva("rounded-card bg-chrome text-chrome-foreground", {
  variants: {
    elevation: {
      flat: "shadow-soft",
      raised: "shadow-soft-lg",
      flush: "bg-chrome-subtle",
    },
    padded: {
      true: "p-5",
      false: "",
    },
  },
  defaultVariants: {
    elevation: "flat",
    padded: true,
  },
});

/**
 * Composition guard for the structural parts (ADR 0114, design/README.md §9.4).
 * Carries no value — it exists so a stray `<Panel.Header>` throws instead of
 * rendering unstyled somewhere it was never meant to be.
 */
const PanelContext = React.createContext<boolean>(false);

function usePanelGuard(part: string): void {
  if (!React.use(PanelContext)) {
    throw new Error(`<Panel.${part}> must be rendered inside <Panel>.`);
  }
}

function PanelRoot({
  className,
  elevation,
  padded,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof panelVariants>) {
  return (
    <PanelContext value={true}>
      <div
        data-slot="panel"
        className={cn(panelVariants({ elevation, padded, className }))}
        {...props}
      />
    </PanelContext>
  );
}

/**
 * The panel's header row. `Panel` was the kit's ONLY surface primitive and had
 * zero structural parts, so every list row and dashboard tile was reinventing
 * its own padding and header layout (design/README.md §9.4). These parts are
 * strictly ADDITIVE — `elevation` and `padded` keep their existing defaults, so
 * the twenty-odd panels already in the app are untouched by this change.
 *
 * The header is a plain flex row rather than a fixed title/meta/action grid: the
 * canvas puts a step counter beside the title on one screen and a scene-selection
 * hint pushed to the far edge on another (design/configurator/frames-v2.jsx:213-217).
 * Callers place a trailing element with `ml-auto`. Encoding those arrangements as
 * props is precisely the proliferation §9.1 exists to prevent.
 */
function PanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  usePanelGuard("Header");
  return (
    <div
      data-slot="panel-header"
      className={cn("mb-4 flex items-center gap-2", className)}
      {...props}
    />
  );
}

/** The panel's heading — Chillax display face at the UI ramp's `lg` rung (15px). */
function PanelTitle({ className, ...props }: React.ComponentProps<"div">) {
  usePanelGuard("Title");
  return (
    <div
      data-slot="panel-title"
      className={cn("font-display text-ui-lg font-semibold", className)}
      {...props}
    />
  );
}

/** Muted secondary text in the header — a step counter, a count, a timestamp. */
function PanelMeta({ className, ...props }: React.ComponentProps<"div">) {
  usePanelGuard("Meta");
  return (
    <div
      data-slot="panel-meta"
      className={cn("text-muted-foreground text-ui-sm", className)}
      {...props}
    />
  );
}

/** The content region. Stacks its children at the panel's internal rhythm. */
function PanelBody({ className, ...props }: React.ComponentProps<"div">) {
  usePanelGuard("Body");
  return <div data-slot="panel-body" className={cn("flex flex-col gap-4", className)} {...props} />;
}

/**
 * Trailing action row, separated by a rule. The rule sits INSIDE the panel's own
 * padding rather than bleeding to the card edge: a full-bleed divider would have
 * to reach back through `padded`, which the root owns and callers override.
 */
function PanelFooter({ className, ...props }: React.ComponentProps<"div">) {
  usePanelGuard("Footer");
  return (
    <div
      data-slot="panel-footer"
      className={cn("border-border mt-4 flex items-center gap-2 border-t pt-4", className)}
      {...props}
    />
  );
}

const Panel = Object.assign(PanelRoot, {
  Header: PanelHeader,
  Title: PanelTitle,
  Meta: PanelMeta,
  Body: PanelBody,
  Footer: PanelFooter,
});

export { Panel, panelVariants };
