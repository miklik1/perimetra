import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

import { Skeleton } from "./skeleton";

/**
 * Multi-line text placeholder — the composite loading shape the kit was missing
 * (design/README.md §8.1: "the kit has `Skeleton` and `Spinner` but no
 * `SkeletonText`/`SkeletonRow`/`SkeletonTable`, so every loading shape is
 * hand-built today"; §9.4 fixes the API as "`lines` plus a `width` pattern; last
 * line short by default"). The configurator's initial catalog fetch is the first
 * consumer (§8.2). No canvas frame draws a loading state, so there is no frame to
 * match — the shape is derived from the kit's own `Skeleton` pulse and nothing is
 * invented beyond it.
 *
 * This COMPOSES `Skeleton`; it does not reimplement the pulse. Every line is a
 * real `Skeleton`, so a change to the pulse token propagates here for free.
 *
 * Two ways to use it, chosen by WHICH SLOT IS FILLED, never by a flag:
 *  - no children → the root generates `lines` bars, cycling `widths`;
 *  - children → the caller composes `<SkeletonText.Line>` (and any other shape)
 *    by hand for a bespoke block. `lines`/`widths` are then ignored.
 *
 * "Filled" is `React.Children.toArray(children).length > 0`, NOT a nullish check:
 * the two mainstream conditional idioms — `{ready && <Line/>}` (yields `false`)
 * and `{items.map(…)}` over an empty list (yields `[]`) — are non-nullish but
 * render nothing, and a nullish test would take them for a filled slot and emit a
 * zero-height block with no error. `toArray` is the primitive that matches the
 * question, since it flattens arrays and DISCARDS booleans/nullish; note that
 * `React.Children.count` does not — it counts a `false` child as one — so it
 * would leave the `{ready && …}` case broken.
 *
 * ACCESSIBILITY CONTRACT (the caller's half). This whole subtree is decorative
 * placeholder content and is `aria-hidden`, so a screen reader hears nothing at
 * all from it. Announcing "loading" is therefore the CALLER'S JOB: put the live
 * region on the element that is actually loading — the region that will hold the
 * real content — e.g. `<section aria-busy="true" aria-live="polite">`. Do not
 * strip the `aria-hidden` here to compensate; a bar count is not information.
 *
 * Reduced motion is handled once, upstream: `Skeleton` carries
 * `motion-reduce:animate-none`, so every call site of the shared pulse honours
 * the preference and this file adds nothing local.
 */
const SkeletonTextContext = React.createContext<boolean>(false);

function useSkeletonTextGuard(part: string): void {
  if (!React.use(SkeletonTextContext)) {
    throw new Error(`<SkeletonText.${part}> must be rendered inside <SkeletonText>.`);
  }
}

/**
 * Default width pattern: every line runs full-bleed except the last, which is cut
 * to ~60% so the block reads as a paragraph that ends mid-line rather than as a
 * solid slab. A single line is NOT shortened — one stubby bar reads as a label,
 * not a paragraph.
 */
const LAST_LINE_WIDTH = "60%";

function defaultWidth(index: number, lines: number): string | undefined {
  return lines > 1 && index === lines - 1 ? LAST_LINE_WIDTH : undefined;
}

type SkeletonTextProps = React.ComponentProps<"div"> & {
  /** How many bars to generate when no children are supplied. */
  lines?: number;
  /**
   * Explicit CSS widths, applied per line and CYCLED when shorter than `lines`
   * (so `["100%", "80%"]` alternates). Supplying it replaces the short-last-line
   * default wholesale — the pattern is the single source of width truth, which is
   * why this is an array and not a `shortLast` flag.
   *
   * That holds for `[]` too: an explicitly EMPTY pattern is a pattern, so every
   * line goes full-bleed with no short last line. Omit the prop (or pass
   * `undefined`) to ask for the default instead. The `length` check below only
   * keeps the cycling modulo off zero — it is not a re-entry to the default.
   */
  widths?: readonly string[];
};

function SkeletonTextRoot({ className, children, lines = 3, widths, ...props }: SkeletonTextProps) {
  const composed = React.Children.toArray(children).length > 0;
  const generated = composed
    ? children
    : Array.from({ length: Math.max(0, lines) }, (_, index) => (
        <SkeletonTextLine
          key={index}
          style={{
            width:
              widths === undefined
                ? defaultWidth(index, lines)
                : widths.length > 0
                  ? widths[index % widths.length]
                  : undefined,
          }}
        />
      ));

  return (
    <SkeletonTextContext value={true}>
      <div
        data-slot="skeleton-text"
        aria-hidden="true"
        className={cn("flex w-full flex-col gap-2", className)}
        {...props}
      >
        {generated}
      </div>
    </SkeletonTextContext>
  );
}

/**
 * One bar. `h-3` is 12px — deliberately NOT the UI body rung (`--text-ui-base` is
 * 13px in an 18px line box; 12px is the `-sm` rung's glyph size). A bar stands in
 * for the INKED BAND of a text line, not its line box: sitting a touch under the
 * glyph size reads as text rather than as a slab, and the root's `gap-2` supplies
 * the leading (12 + 8 = 20px per line against the real 18px). So the number is
 * chosen for the band, not inherited from a type rung — retune it against that
 * intent, not by matching it to `--text-ui-base`. Width comes from the root's
 * pattern or, in hand-composed blocks, the caller's own `style`/`className`.
 */
function SkeletonTextLine({ className, ...props }: React.ComponentProps<"div">) {
  useSkeletonTextGuard("Line");
  return (
    <Skeleton
      data-slot="skeleton-text-line"
      className={cn("rounded-inset h-3 w-full", className)}
      {...props}
    />
  );
}

const SkeletonText = Object.assign(SkeletonTextRoot, {
  Line: SkeletonTextLine,
});

export { SkeletonText };
