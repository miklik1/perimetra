import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

import { Icon } from "./icon";

/**
 * Guided wizard step rail (ADR 0114, design/README.md §9.5).
 *
 * Rewritten from the ADR 0072 pill bar, which was an items-array with
 * `label: string` and could not express what the canvas draws: a
 * numbered/checked/locked dot, a per-step VALUE sub-line, and a `V1` badge on a
 * step that is announced but not yet available
 * (design/configurator/frames-v2.jsx:177-195). Those are four independent pieces
 * of content per step, so the step becomes a composition rather than a record.
 *
 * ## Density is not a prop
 *
 * The canvas draws this rail at 210px with labels and at 60px as dots only, and
 * the export switches with a `compact` boolean. This component switches on a
 * CONTAINER QUERY instead — the same rule §9.3 fixes for `SideNav` ("there is no
 * `collapsed` prop"). A boolean here would have to be computed by every screen
 * that renders a wizard, and screens that compute the same thing separately
 * eventually disagree. The rail simply reports what fits in the space it was
 * given: below `10rem` the labels and sub-lines drop out and each item keeps its
 * accessible name, so nothing is lost to a screen reader at any width.
 *
 * The threshold is `10rem` (160px) and that number is load-bearing. It was
 * `18rem` (288px) until the ADR 0116 configurator surface tried to use this
 * component at the very width the paragraph above documents: a container query
 * measures the nav's own CONTENT box, so the canvas's 210px rail presents about
 * 186px here — under 288px, so the expanded state was structurally unreachable
 * and the rail always drew as dots, contradicting this file's own stated intent.
 * 160px sits cleanly between the collapsed rail (~44px) and that 186px, so both
 * documented densities are now reachable. Any future change must be checked
 * against the CONTENT box, not the rail's outer width.
 *
 * The compact rail in the export labels its dots with the native `title`
 * attribute, which §12.2 bans outright — `title` is invisible to keyboard and
 * touch users and is not an accessible name. Here the label is a real slot that
 * becomes visually hidden, so the name survives the collapse.
 *
 * ## Where the ordinals come from
 *
 * Each dot's number is its position among the `StepNav.Item`s in the CHILDREN it
 * was written with, derived in one synchronous render-time pass (`withOrdinals`)
 * and handed down through `StepOrdinalContext`. The root numbers its own
 * children; `StepNav.List` numbers its own, for the common case where a layout
 * wrapper (a scroll area, a flex column) sits between the rail and its steps.
 *
 * The contract that buys: an item must be an immediate child of `<StepNav>` or of
 * a `<StepNav.List>`. An item generated inside a caller's OWN component is
 * invisible to the walk and renders a blank dot — that is a real narrowing versus
 * reading the DOM, and it is deliberate, because the DOM read could only ever run
 * once (see `StepNavDot`).
 *
 * The mobile progress indicator is deliberately NOT this component — see
 * `StepProgress` below.
 */

type StepState = "done" | "locked";

type StepNavContextValue = {
  value: string | undefined;
  select: (value: string) => void;
};

const StepNavContext = React.createContext<StepNavContextValue | null>(null);

function useStepNav(part: string): StepNavContextValue {
  const ctx = React.use(StepNavContext);
  if (!ctx) {
    throw new Error(`<StepNav.${part}> must be rendered inside <StepNav>.`);
  }
  return ctx;
}

/** Per-item channel, so the dot and the label can read state without prop drilling. */
type StepItemContextValue = { state: StepState | undefined; active: boolean };

const StepItemContext = React.createContext<StepItemContextValue | null>(null);

function useStepItem(part: string): StepItemContextValue {
  const ctx = React.use(StepItemContext);
  if (!ctx) {
    throw new Error(`<StepNav.${part}> must be rendered inside <StepNav.Item>.`);
  }
  return ctx;
}

/**
 * Per-item ordinal channel. `null` means "nobody numbered me", which the dot
 * renders as an empty slot rather than a wrong number.
 */
const StepOrdinalContext = React.createContext<number | null>(null);

/**
 * Numbers the `StepNav.Item`s in one children list, 1-based, and returns the list
 * with each item wrapped in its own ordinal provider.
 *
 * Everything that is not a `StepNav.Item` element — text, `null`, a `false` from a
 * short-circuit, a `Heading`, a caller's own wrapper — passes through untouched
 * AND does not advance the counter. That last part is the whole point: a
 * `{cond && <StepNav.Item/>}` must not leave a gap in the numbering, and a
 * `Heading` must not consume the number 1.
 *
 * It is a pure render-time pass: no effect, no ref, no module-level mutable state,
 * so it runs correctly under concurrent rendering and it is already right in the
 * server HTML. `React.Children.map` flattens nested arrays, so an inline
 * `{steps.map(…)}` numbers exactly as if the items had been written out.
 */
function withOrdinals(children: React.ReactNode): React.ReactNode {
  let ordinal = 0;
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child) || child.type !== StepNavItem) return child;
    ordinal += 1;
    return <StepOrdinalContext value={ordinal}>{child}</StepOrdinalContext>;
  });
}

type StepNavProps = Omit<React.ComponentProps<"nav">, "onChange"> & {
  value?: string;
  onValueChange?: (value: string) => void;
};

function StepNavRoot({ className, value, onValueChange, children, ...props }: StepNavProps) {
  const select = React.useCallback(
    (next: string) => {
      onValueChange?.(next);
    },
    [onValueChange],
  );

  return (
    <StepNavContext value={{ value, select }}>
      <nav
        data-slot="step-nav"
        className={cn("@container/step-nav flex flex-col gap-0.5", className)}
        {...props}
      >
        {withOrdinals(children)}
      </nav>
    </StepNavContext>
  );
}

/**
 * Optional grouping slot for the steps themselves. It exists for one reason: a
 * rail that puts its items inside a layout wrapper (a `FadeScrollArea`, a flex
 * column) breaks the root's children walk, because the root then sees the wrapper
 * and not the steps. Wrapping them in `<StepNav.List>` instead of a bare `<div>`
 * restores the numbering without the rail having to count anything itself.
 *
 * It renders a plain container with no layout of its own — the caller keeps
 * spelling its own `className`, because a scroll column and a chip row want
 * different ones. Nesting is unambiguous: the innermost provider wins, so a List
 * inside the root re-numbers only what it contains.
 */
function StepNavList({ className, children, ...props }: React.ComponentProps<"div">) {
  useStepNav("List");
  return (
    <div data-slot="step-nav-list" className={cn(className)} {...props}>
      {withOrdinals(children)}
    </div>
  );
}

/**
 * The rail's section caption ("Konfigurace"). Drops out with the labels when the
 * rail collapses, since a caption over a column of dots says nothing.
 */
function StepNavHeading({ className, ...props }: React.ComponentProps<"div">) {
  useStepNav("Heading");
  return (
    <div
      data-slot="step-nav-heading"
      className={cn(
        "hidden px-2 pt-0.5 pb-2 text-ui-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase @[10rem]/step-nav:block",
        className,
      )}
      {...props}
    />
  );
}

type StepNavItemProps = Omit<React.ComponentProps<"button">, "value"> & {
  value: string;
  /**
   * `done` and `locked` are mutually exclusive step STATES, which is why this is
   * one string union rather than two booleans — a step cannot be both, and two
   * booleans can encode that contradiction. The `active` state is NOT here: it
   * is derived from the root's `value`, so the rail cannot disagree with itself
   * about which step the user is on.
   */
  state?: StepState;
};

function StepNavItem({ className, value, state, onClick, children, ...props }: StepNavItemProps) {
  const nav = useStepNav("Item");
  const active = nav.value === value;
  const locked = state === "locked";

  return (
    <StepItemContext value={{ state, active }}>
      <button
        type="button"
        data-slot="step-nav-item"
        data-state={state}
        data-active={active || undefined}
        aria-current={active ? "step" : undefined}
        aria-disabled={locked || undefined}
        className={cn(
          "flex items-center gap-3 rounded-control p-2 text-left transition-colors duration-200 ease-brand outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          "justify-center @[10rem]/step-nav:justify-start @[10rem]/step-nav:px-2.5 @[10rem]/step-nav:py-2.5",
          active && "bg-chrome-subtle shadow-[inset_2px_0_0_var(--color-copper)]",
          locked ? "cursor-default opacity-disabled" : "cursor-pointer hover:bg-chrome-subtle",
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || locked) return;
          nav.select(value);
        }}
        {...props}
      >
        <StepNavDot />
        {/*
         * ONE render of the children, visually hidden rather than removed below
         * the collapse threshold. Rendering them twice (once visible, once
         * sr-only) would duplicate the DOM and double-run any effect a child
         * carries; `sr-only` -> `not-sr-only` keeps the accessible name intact at
         * every width from a single subtree.
         */}
        <span className="sr-only @[10rem]/step-nav:not-sr-only @[10rem]/step-nav:flex @[10rem]/step-nav:min-w-0 @[10rem]/step-nav:flex-1 @[10rem]/step-nav:flex-col">
          {children}
        </span>
      </button>
    </StepItemContext>
  );
}

/**
 * The 26px status dot. Its content is DERIVED from the step's state — a lock
 * glyph, a check, or the step's ordinal — so a caller cannot render a checkmark
 * on a step it also marked locked.
 *
 * The ordinal is READ, never passed: it comes from `StepOrdinalContext`, which the
 * root (or a `StepNav.List`) fills from the item's position among its siblings on
 * every render. Letting the caller pass an index would let the rail's numbering
 * drift from its own order the first time a step is conditionally rendered, which
 * is exactly what happens when a release authors a different step set per product.
 *
 * This used to be a DOM measurement — a ref callback that walked up to the rail and
 * asked for `querySelectorAll('[data-slot="step-nav-item"]').indexOf(…)`. That read
 * the right answer but only ONCE: the callback identity was stable and the span was
 * never remounted, so React invoked it exactly once per mount. A step appearing
 * later left every already-mounted dot on its mount-time number while the new dot
 * computed a fresh, colliding one — the precise drift the paragraph above exists to
 * prevent. It also painted an empty dot on the server, since a ref never runs there.
 * A render-time derivation has neither failure.
 */
function StepNavDot() {
  const { state, active } = useStepItem("Dot");
  const ordinal = React.use(StepOrdinalContext);

  return (
    <span
      data-slot="step-nav-dot"
      aria-hidden={true}
      className={cn(
        "grid size-[26px] shrink-0 place-items-center rounded-full",
        state === "done"
          ? "bg-copper text-copper-foreground"
          : active
            ? "border-2 border-copper bg-chrome text-copper"
            : "bg-chrome-subtle text-muted-foreground",
      )}
    >
      {state === "locked" ? (
        <Icon name="lock" size={13} />
      ) : state === "done" ? (
        <Icon name="check" size={14} />
      ) : (
        <span className="font-data text-ui-sm font-semibold">{ordinal}</span>
      )}
    </span>
  );
}

/** The step's name. Also the item's accessible name once the rail collapses. */
function StepNavLabel({ className, ...props }: React.ComponentProps<"span">) {
  const { active } = useStepItem("Label");
  return (
    <span
      data-slot="step-nav-label"
      className={cn("text-ui-base", active ? "font-semibold" : "font-medium", className)}
      {...props}
    />
  );
}

/**
 * The step's current VALUE, echoed under its name ("4 000 × 1 800"). Truncates
 * rather than wraps: the rail is a fixed column and a two-line step would push
 * the rest of the wizard out of alignment.
 */
function StepNavSub({ className, ...props }: React.ComponentProps<"span">) {
  useStepItem("Sub");
  return (
    <span
      data-slot="step-nav-sub"
      className={cn("truncate text-ui-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

const StepNav = Object.assign(StepNavRoot, {
  Heading: StepNavHeading,
  List: StepNavList,
  Item: StepNavItem,
  Label: StepNavLabel,
  Sub: StepNavSub,
});

/**
 * The mobile step indicator (design/configurator/frames-v2.jsx:409-415) — a row
 * of bars with the active one widened, plus an "n/m" readout.
 *
 * This is a SEPARATE component, not a third density of `StepNav`, because it is
 * not the same thing: it has no labels, no dots and no interactive targets. It
 * REPORTS progress where the rail NAVIGATES it. Folding it in would mean a rail
 * whose items sometimes are not buttons — the boolean-mode trap one level up
 * (patterns-explicit-variants). Mobile navigates with the wizard's own Back/Next
 * controls, exactly as the canvas draws it.
 *
 * It is presentational, so it carries `role="progressbar"` with real values
 * rather than a list of unlabelled decorative bars.
 */
function StepProgress({
  total,
  current,
  className,
  ...props
}: React.ComponentProps<"div"> & { total: number; current: number }) {
  return (
    <div
      data-slot="step-progress"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      className={cn("flex items-center gap-2.5", className)}
      {...props}
    >
      <span className="flex flex-1 items-center justify-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            data-slot="step-progress-bar"
            data-reached={i + 1 <= current || undefined}
            className={cn(
              "h-1 rounded-full",
              i + 1 === current ? "w-[22px]" : "w-[7px]",
              i + 1 <= current ? "bg-copper" : "bg-border",
            )}
          />
        ))}
      </span>
      <span className="font-data text-ui-sm text-muted-foreground">
        {current}/{total}
      </span>
    </div>
  );
}

export { StepNav, StepProgress };
