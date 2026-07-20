import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

import { Icon, type IconName } from "./icon";

/**
 * Composition guard only — it carries no value. It exists so a stray
 * `<StickyActionBar.Action>` rendered outside the bar THROWS with a branded
 * message instead of quietly rendering an unstyled row (same contract as
 * `useStatCardGuard` in `stat-card.tsx`; design/README.md §9.1).
 */
const StickyActionBarContext = React.createContext<boolean>(false);

function useStickyActionBarGuard(part: string): void {
  if (!React.use(StickyActionBarContext)) {
    throw new Error(`<StickyActionBar.${part}> must be rendered inside <StickyActionBar>.`);
  }
}

/**
 * Tone is the ONLY switch on this component and it is a string, never a
 * boolean: `primary` is the tablet commercial bar (a saturated ink/copper slab
 * — design/configurator/frames-v2.jsx:388-393), `chrome` is the mobile bottom
 * sheet footer that sits on the sheet's own matte surface
 * (frames-v2.jsx:428-433). Ink is set once on the root and inherited by every
 * part through CSS, so no part needs to know which tone it is inside.
 *
 * The bottom padding is where this component earns its existence: the safe-area
 * inset is FOLDED INTO the bar's own padding with `calc()` rather than added as
 * a margin, so on a notched device the fill still reaches the bottom edge of the
 * screen and only the CONTENT is pushed clear of the home indicator. A margin
 * would leave a stripe of the scrolling content showing under the bar.
 */
const stickyActionBarVariants = cva(
  [
    "sticky bottom-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2",
    "px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
    "border-border border-t",
    "ease-brand transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none",
  ],
  {
    variants: {
      tone: {
        primary: "bg-primary text-primary-foreground shadow-float",
        chrome: "bg-chrome text-chrome-foreground shadow-soft-lg",
      },
    },
    defaultVariants: {
      tone: "primary",
    },
  },
);

/**
 * Generic sticky slot container pinned to the bottom of its containing scroll
 * context (design/README.md §9.2 assigns it to `@repo/ui` explicitly: the bar is
 * the frame, the commercial content is passed in as children by app-land, so
 * this file carries no product vocabulary at all).
 *
 * The canvas's three layouts fall out of WHICH SLOTS ARE FILLED — there is no
 * `layout` prop and the consumer writes no conditionals:
 *
 * - `Price` + `Action` → a row, the action pushed to the trailing edge.
 * - `Action` alone → the action becomes the first child, and its own children
 *   each take an equal share of the row (which is how the mobile primary CTA
 *   fills the sheet).
 * - `Action` + `Note` → `Note` is `basis-full`, so it wraps onto its own line
 *   under the row without anyone declaring a second container.
 *
 * The top border plus a token elevation shadow are what separate the bar from
 * content scrolling underneath it — the flat-matte depth model (ADR 0072), never
 * a blur or a gradient.
 */
function StickyActionBarRoot({
  className,
  tone,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof stickyActionBarVariants>) {
  return (
    <StickyActionBarContext value={true}>
      <div
        data-slot="sticky-action-bar"
        // `group` is the minimum role that can HOLD an accessible name. A bare
        // `<div>` is `role=generic`, on which ARIA prohibits `aria-label` — AT
        // drops it, so the label the consumer passes would be announced by
        // nobody while still reading back through `getByLabelText` in a test.
        role="group"
        className={cn(stickyActionBarVariants({ tone, className }))}
        {...props}
      >
        {children}
      </div>
    </StickyActionBarContext>
  );
}

/**
 * Leading readout column — a tight two-line stack (caption over figure) in the
 * canvas. Deliberately typography-free apart from the tight leading: the figure
 * face (`font-data tabular-nums`) belongs to the value element app-land puts
 * inside, because the caption line above it is NOT numeric and must stay in the
 * sans face. `min-w-0` so a long readout truncates instead of shoving the
 * action off the trailing edge.
 */
function StickyActionBarPrice({ className, ...props }: React.ComponentProps<"div">) {
  useStickyActionBarGuard("Price");
  return (
    <div
      data-slot="sticky-action-bar-price"
      className={cn("flex min-w-0 flex-col justify-center leading-tight", className)}
      {...props}
    />
  );
}

/**
 * Trailing action cluster. `flex-1` + `justify-end` keeps the buttons on the
 * trailing edge whenever anything precedes them; when the bar has NO price the
 * action is `:first-child` and its own children each take an equal share of the
 * row (`[&:first-child>*]:flex-1` — `justify-content` cannot do this, `stretch`
 * behaves as `flex-start` in a flex container). That is the CTA-only layout,
 * derived from the DOM rather than from a prop the caller must remember to pass.
 */
function StickyActionBarAction({ className, ...props }: React.ComponentProps<"div">) {
  useStickyActionBarGuard("Action");
  return (
    <div
      data-slot="sticky-action-bar-action"
      className={cn(
        "flex flex-1 items-center justify-end gap-3",
        "[&:first-child>*]:flex-1",
        className,
      )}
      {...props}
    />
  );
}

type StickyActionBarNoteTone = "muted" | "success" | "warning" | "destructive" | "info";

/**
 * Note ink is DERIVED against the bar's own inherited ink (`currentColor`), not
 * taken bare from the semantic token. This is the one place in the kit where a
 * status colour sits on a surface that INVERTS between themes while the semantic
 * tokens do not — `--color-primary` goes oklch(0.2178) near-black → oklch(0.98)
 * near-white, `--color-warning` only 0.75 → 0.78 — so a bare `text-warning`
 * cannot be correct on both. Measured (WCAG, all four bar-tone × theme
 * combinations, sRGB via oklab):
 *
 * ```
 *              primary/LIGHT  primary/DARK  chrome/LIGHT  chrome/DARK
 * bare token
 *   success        5.23          2.59 ✗        3.33 ✗       5.43
 *   warning        7.65          1.93 ✗        2.27 ✗       7.28
 *   destructive    3.65 ✗        2.73 ✗        4.76         5.15
 *   info           4.84          2.90 ✗        3.59 ✗       4.85
 * 55% tone + currentColor  (this file)
 *   success        9.29          6.29          7.51         8.59
 *   warning       11.21          5.19          5.90         9.97
 *   destructive    7.75          6.47          9.38         8.28
 *   info           8.95          6.75          7.86         8.13
 * ```
 *
 * The `alert.tsx` chip approach (`text-*` on a `bg-*-subtle` fill) was measured
 * FIRST and rejected here for a structural reason, not a stylistic one:
 * `--color-destructive-subtle` is `color-mix(destructive 5%, transparent)` — an
 * ALPHA tint, not an opaque surface. On the page background it reads as a fill;
 * composited onto the near-black `primary` bar it stays near-black, and the
 * `text-foreground` ink `alert.tsx` pairs with it measures 1.06:1 light /
 * 1.04:1 dark. A chip only works where the fill is opaque; this bar is not.
 *
 * Mixing toward `currentColor` instead makes the ink TRACK the inversion for
 * free (it resolves against whichever `-foreground` the bar tone set), so the
 * floor is 5.19:1 and a new bar tone cannot silently break it. 55% is the
 * measured knee: it keeps the hue plainly readable while every combination
 * clears 4.5:1 with headroom.
 */
const stickyActionBarNoteVariants = cva(
  "text-ui-sm flex basis-full items-center gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        /** Inherits the bar's own ink at reduced strength — 7.1–8.1:1 on all four combinations. */
        muted: "opacity-70",
        success: "text-[color-mix(in_oklab,var(--color-success)_55%,currentColor)]",
        warning: "text-[color-mix(in_oklab,var(--color-warning)_55%,currentColor)]",
        destructive: "text-[color-mix(in_oklab,var(--color-destructive)_55%,currentColor)]",
        info: "text-[color-mix(in_oklab,var(--color-info)_55%,currentColor)]",
      },
    },
    defaultVariants: {
      tone: "muted",
    },
  },
);

/**
 * Default glyph per tone, so the tone survives greyscale and colour-blindness —
 * the same contract `alert.tsx` enforces with its own `TONE_GLYPH`. `muted` gets
 * none: it is the absence of a status, and a glyph would invent one.
 */
const NOTE_TONE_GLYPH: Record<StickyActionBarNoteTone, IconName | null> = {
  muted: null,
  success: "check",
  warning: "warn",
  destructive: "warn",
  info: "list",
};

/**
 * Live-region politeness is DERIVED from the tone, never taken as a prop (the
 * `alert.tsx` rule): a note that appears after a failed action must interrupt
 * (`alert`), a success/warning/info note announces politely (`status`), and a
 * `muted` hint is not a live region at all. A prop here would only produce notes
 * whose urgency contradicts their colour.
 */
function roleForNoteTone(tone: StickyActionBarNoteTone): "alert" | "status" | undefined {
  if (tone === "destructive") return "alert";
  return tone === "muted" ? undefined : "status";
}

const StickyActionBarNoteToneContext = React.createContext<StickyActionBarNoteTone | null>(null);

/**
 * The note's leading glyph. DECORATIVE (`aria-hidden`) on purpose: the meaning
 * is already carried by the note text and by the derived live-region role, so
 * announcing the shape would only add noise. The `Note` renders one of these
 * automatically for every non-`muted` tone; passing your own — with or without
 * children — REPLACES the default rather than adding a second glyph.
 */
function StickyActionBarNoteIcon({ className, children, ...props }: React.ComponentProps<"span">) {
  const tone = React.use(StickyActionBarNoteToneContext);
  if (tone === null) {
    throw new Error(`<StickyActionBar.NoteIcon> must be rendered inside <StickyActionBar.Note>.`);
  }
  const glyph = NOTE_TONE_GLYPH[tone];

  return (
    <span
      data-slot="sticky-action-bar-note-icon"
      aria-hidden={true}
      className={cn("inline-flex h-5 items-center", className)}
      {...props}
    >
      {children ?? (glyph === null ? null : <Icon name={glyph} size={14} />)}
    </span>
  );
}

/**
 * Supporting line under the row (`basis-full` is what puts it there — the root
 * wraps). `tone` is a string variant, not a set of booleans, so a status line
 * can carry semantic colour without the bar growing a `hasError` flag — and the
 * tone drives three channels at once (ink, glyph, live-region role), so colour
 * is never the sole carrier of what the note means.
 */
function StickyActionBarNote({
  className,
  tone,
  children,
  ...props
}: React.ComponentProps<"p"> & VariantProps<typeof stickyActionBarNoteVariants>) {
  useStickyActionBarGuard("Note");
  const resolved: StickyActionBarNoteTone = tone ?? "muted";
  const hasOwnIcon = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === StickyActionBarNoteIcon,
  );

  return (
    <StickyActionBarNoteToneContext value={resolved}>
      <p
        data-slot="sticky-action-bar-note"
        data-tone={resolved}
        role={roleForNoteTone(resolved)}
        className={cn(stickyActionBarNoteVariants({ tone: resolved, className }))}
        {...props}
      >
        {hasOwnIcon || NOTE_TONE_GLYPH[resolved] === null ? null : <StickyActionBarNoteIcon />}
        {children}
      </p>
    </StickyActionBarNoteToneContext>
  );
}

const StickyActionBar = Object.assign(StickyActionBarRoot, {
  Price: StickyActionBarPrice,
  Action: StickyActionBarAction,
  Note: StickyActionBarNote,
  NoteIcon: StickyActionBarNoteIcon,
});

export { StickyActionBar, stickyActionBarVariants };
