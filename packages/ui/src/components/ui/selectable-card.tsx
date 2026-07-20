import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

import { Badge } from "./badge";

/**
 * A single-select card/tile/swatch, and the radiogroup semantics that go with it
 * (ADR 0114, design/README.md §9.4).
 *
 * This component unifies FOUR visually unrelated treatments the canvas draws:
 * the desktop product-family grid card, the mobile family list row, the colour
 * swatch, and the catalog family row. §9.4 calls it the highest-risk new
 * component for exactly that reason, so the rule that keeps it honest is stated
 * up front and is not negotiable:
 *
 *   **The four treatments come from WHICH SLOTS ARE FILLED and from the group's
 *   layout context — never from a `variant` prop.**
 *
 * - colour swatch  → `Visual` only, with `Title` rendered `sr-only`
 * - mobile row     → `Visual` + `Title` + `Description`
 * - desktop card   → adds `Meta`
 * - catalog row    → adds `Badge`
 *
 * Grid-versus-list is a property of the GROUP's container, set by the consuming
 * screen's CSS. Nothing here needs to know which of the four it is.
 *
 * Why this replaces hand-rolled buttons: every selectable control in the export
 * is a `<div>` with an `onClick` and no selection semantics — no `aria-checked`,
 * no roving tabindex, no keyboard support (design/README.md §8.1). The swatches
 * additionally lean on the native `title` attribute for their label, which §12.2
 * bans outright. Making the label a SLOT rather than a string template is also
 * the fix for the export's broken `RAL pozink` label, which came from
 * interpolating `"RAL " + key` over a key that is not a RAL number at all.
 */

type SelectableCardGroupContextValue = {
  value: string | undefined;
  select: (value: string) => void;
};

const SelectableCardGroupContext = React.createContext<SelectableCardGroupContextValue | null>(
  null,
);

function useSelectableCardGroup(): SelectableCardGroupContextValue {
  const ctx = React.use(SelectableCardGroupContext);
  if (!ctx) {
    throw new Error("<SelectableCard> must be rendered inside <SelectableCard.Group>.");
  }
  return ctx;
}

/** Composition guard for the card's own slots. Carries no value. */
const SelectableCardContext = React.createContext<boolean>(false);

function useSelectableCardGuard(part: string): void {
  if (!React.use(SelectableCardContext)) {
    throw new Error(`<SelectableCard.${part}> must be rendered inside <SelectableCard>.`);
  }
}

type SelectableCardGroupProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  value?: string;
  onValueChange?: (value: string) => void;
  /** Roving-tabindex direction. Both axes stay operable; this picks the primary one. */
  orientation?: "horizontal" | "vertical";
};

/**
 * Owns the selection, the roving tabindex and arrow-key navigation.
 *
 * Focus order is read from the DOM at keypress time rather than from a
 * registration list. Registration order and visual order drift apart the moment
 * a consumer filters or re-sorts its items — and this group's whole job is to
 * render a list that a release's assigned/pinned set decides at runtime.
 */
function SelectableCardGroup({
  className,
  value,
  onValueChange,
  orientation = "horizontal",
  onKeyDown,
  ...props
}: SelectableCardGroupProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  const select = React.useCallback(
    (next: string) => {
      onValueChange?.(next);
    },
    [onValueChange],
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    const backward = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    // The cross axis stays operable too: a grid of cards is navigated with all
    // four arrows by anyone who does not know which axis we nominated.
    const isForward =
      event.key === forward || event.key === "ArrowDown" || event.key === "ArrowRight";
    const isBackward =
      event.key === backward || event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!isForward && !isBackward) return;

    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    if (items.length === 0) return;

    const current = items.findIndex((item) => item === document.activeElement);
    const delta = isForward ? 1 : -1;
    const next =
      items[
        ((((current === -1 ? 0 : current) + delta) % items.length) + items.length) % items.length
      ];
    if (!next) return;

    event.preventDefault();
    next.focus();

    // Focus moves onto a disabled option so it stays DISCOVERABLE (§9.4: a
    // disabled option a user cannot find is worse than one they can read), but
    // selection does not follow onto it.
    if (next.getAttribute("aria-disabled") !== "true") {
      select(next.dataset.value ?? "");
    }
  }

  return (
    <SelectableCardGroupContext value={{ value, select }}>
      <div
        ref={ref}
        data-slot="selectable-card-group"
        role="radiogroup"
        aria-orientation={orientation}
        className={cn("flex gap-3", orientation === "vertical" && "flex-col", className)}
        onKeyDown={handleKeyDown}
        {...props}
      />
    </SelectableCardGroupContext>
  );
}

type SelectableCardProps = Omit<React.ComponentProps<"button">, "value" | "disabled"> & {
  value: string;
  disabled?: boolean;
};

/**
 * A real `<button role="radio">` with `aria-checked` — never a `<div>` with an
 * `onClick`.
 *
 * `disabled` renders the *Připravujeme* state as `aria-disabled` rather than the
 * native `disabled` attribute, deliberately: a natively-disabled button is
 * removed from the tab order entirely, and a product family a customer cannot
 * even discover is worse than one they can read and understand is coming.
 */
function SelectableCardRoot({
  className,
  value,
  disabled = false,
  onClick,
  ...props
}: SelectableCardProps) {
  const group = useSelectableCardGroup();
  const selected = group.value === value;

  // Roving tabindex: the group is ONE tab stop. The checked option holds it; if
  // nothing is checked yet the FIRST option does, so the group is always
  // reachable by keyboard (W3C APG radiogroup).
  //
  // "Am I first?" is answered by a mount-time callback ref rather than an effect.
  // An effect without a dependency array would re-run on every render, and the
  // honest dependency here is DOM position, which React cannot express as one.
  const ref = React.useRef<HTMLButtonElement | null>(null);
  const [isFirst, setIsFirst] = React.useState(false);
  const measure = React.useCallback((el: HTMLButtonElement | null) => {
    ref.current = el;
    if (!el) return;
    setIsFirst(el.closest('[role="radiogroup"]')?.querySelector('[role="radio"]') === el);
  }, []);

  return (
    <SelectableCardContext value={true}>
      <button
        ref={measure}
        type="button"
        data-slot="selectable-card"
        data-value={value}
        role="radio"
        aria-checked={selected}
        aria-disabled={disabled || undefined}
        tabIndex={group.value === undefined ? (isFirst ? 0 : -1) : selected ? 0 : -1}
        className={cn(
          "ease-brand rounded-card border-border bg-chrome text-chrome-foreground relative flex flex-col items-start gap-1.5 border p-4 text-left outline-none transition-colors duration-200",
          "focus-visible:ring-ring focus-visible:ring-2",
          "aria-checked:border-copper aria-checked:ring-copper aria-checked:ring-1",
          disabled ? "opacity-disabled cursor-default" : "hover:bg-chrome-hover cursor-pointer",
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (disabled) return;
          group.select(value);
        }}
        {...props}
      />
    </SelectableCardContext>
  );
}

/**
 * The glyph, render or colour chip. In the swatch treatment this is the ONLY
 * filled slot, which is why the card never derives its accessible name from
 * here — the name always comes from `Title`.
 */
function SelectableCardVisual({ className, ...props }: React.ComponentProps<"div">) {
  useSelectableCardGuard("Visual");
  return (
    <div
      data-slot="selectable-card-visual"
      className={cn("flex w-full items-center justify-center", className)}
      {...props}
    />
  );
}

/**
 * The card's label AND its accessible name. Render it `sr-only` for the swatch
 * treatment — the name must still exist even when nothing is drawn.
 */
function SelectableCardTitle({ className, ...props }: React.ComponentProps<"span">) {
  useSelectableCardGuard("Title");
  return (
    <span
      data-slot="selectable-card-title"
      className={cn("text-ui-base font-semibold", className)}
      {...props}
    />
  );
}

function SelectableCardDescription({ className, ...props }: React.ComponentProps<"span">) {
  useSelectableCardGuard("Description");
  return (
    <span
      data-slot="selectable-card-description"
      className={cn("text-muted-foreground text-ui-sm", className)}
      {...props}
    />
  );
}

/** Trailing data line — a price, a count. Amulya, so numerals align card to card. */
function SelectableCardMeta({ className, ...props }: React.ComponentProps<"span">) {
  useSelectableCardGuard("Meta");
  return (
    <span
      data-slot="selectable-card-meta"
      className={cn("font-data text-ui-sm tabular-nums", className)}
      {...props}
    />
  );
}

/** Corner status pill — *Připravujeme*, *Skryto*. Reuses the kit's Badge tones. */
function SelectableCardBadge({ className, ...props }: React.ComponentProps<typeof Badge>) {
  useSelectableCardGuard("Badge");
  return (
    <Badge
      data-slot="selectable-card-badge"
      className={cn("absolute right-3 top-3", className)}
      {...props}
    />
  );
}

const SelectableCard = Object.assign(SelectableCardRoot, {
  Group: SelectableCardGroup,
  Visual: SelectableCardVisual,
  Title: SelectableCardTitle,
  Description: SelectableCardDescription,
  Meta: SelectableCardMeta,
  Badge: SelectableCardBadge,
});

export { SelectableCard };
