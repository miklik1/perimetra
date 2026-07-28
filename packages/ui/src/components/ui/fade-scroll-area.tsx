import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Real scroll container carrying the canvas's masked-edge signature (design/README.md
 * §8.1, §9.4). On the design canvas "scrolling is faked everywhere": every list and
 * body region is `overflow: hidden` plus
 * `maskImage: linear-gradient(to bottom, black calc(100% - 12px), transparent)`
 * (design/configurator/frames-v2.jsx:280 form column, :385 the tablet reuse). Here the
 * region becomes a GENUINE scroll container (`overflow-y: auto`) and the fade survives
 * as an honest scroll CUE rather than decoration.
 *
 * Why `mask-image` and not a gradient overlay: an overlay has to be painted in the
 * surface's own colour, so a white→transparent scrim is wrong the moment the theme
 * flips to dark, and wrong again over `bg-chrome-subtle`. A mask is colour-INDEPENDENT
 * — it modulates alpha of whatever is underneath — so one recipe is correct on every
 * surface in both themes with no token lookup at all. The only tunable is the fade
 * LENGTH, exposed as the `--fade-scroll-length` custom property (default `12px`, the
 * canvas value) so a caller can override it through `className`.
 *
 * Why a scroll listener and not `animation-timeline: scroll()`: scroll-driven CSS
 * animations are not yet safe to rely on (no Safari/Firefox baseline), and the failure
 * mode of a CSS-only attempt is the wrong one — the mask would stay static and clip
 * content. So edge state is measured in JS.
 *
 * The measurement DEGRADES TO "NO MASK AT ALL", never to clipped content. `measure()`
 * runs on mount and on every scroll event regardless of `ResizeObserver`, so a missing
 * `ResizeObserver` costs only the *content-resize* refresh, not measurement itself;
 * and because the mask is applied only while an edge is genuinely active (see
 * `maskImage` below), every un-measured or settled state renders completely unmasked.
 *
 * The correctness point the canvas gets wrong: a STATIC bottom mask keeps fading the
 * last row even when the user has scrolled to the very end, so content that is fully
 * revealed still looks cut off — the cue lies about there being more. Each edge here
 * is masked only while there is actually content past it.
 *
 * ## Two elements, and why (WCAG 2.4.7)
 *
 * The scroll region is keyboard-focusable while it overflows (WCAG 2.1.1 / axe
 * `scrollable-region-focusable`), so it must show a visible focus indicator — but a
 * focus indicator CANNOT live on a masked element. CSS masking clips and alpha-
 * modulates everything the element paints, the indicator included. Verified in headless
 * Chromium against a standalone repro rather than argued from the spec:
 *
 *   - `box-shadow` ring (what Tailwind's `ring-2` compiles to) + `mask-image`
 *     → ring is 100% INVISIBLE. Not dimmed: absent (it paints outside the border box,
 *     which the default `mask-clip: border-box` removes entirely).
 *   - `outline` + `mask-image` → likewise INVISIBLE. Swapping the indicator primitive
 *     does not help.
 *   - `mask-clip: no-clip` → ring paints, but the gradient's transparent stops wash out
 *     its top and bottom runs, so the indicator is still not solid. Not a fix.
 *   - Unmasked ANCESTOR carrying the ring via `:has(:focus-visible)`, masked scroller
 *     inside → ring paints at full opacity AND the fade survives. This is the fix.
 *
 * Hence the root/scroller split below: the root is unmasked and owns the focus ring;
 * the scroller is masked and owns overflow. The mask has to stay on the scroll VIEWPORT
 * (on an inner content wrapper it would scroll away with the content), and it cannot
 * move up to the root because a mask clips descendants too — so the indicator has
 * nowhere to live except an ancestor.
 *
 * ## Caller contract
 *
 * The ROOT is the element you size, style and ref: `className`, `style`, `ref` and any
 * other props land there, so a `max-h-*` belongs on `<FadeScrollArea>` itself. The root
 * is a `min-h-0` flex column and the scroller is its `flex-1 min-h-0` child — measured,
 * not assumed: giving the scroller `h-full` instead makes `height: 100%` resolve
 * against an auto-height root, so it grows to its content and NEVER scrolls. The
 * horizontal orientation is the exact mirror (`min-w-0` row, `flex-1 min-w-0` child),
 * for the same reason on the other axis.
 *
 * The scroll-region props — `role`, `tabIndex`, `aria-label`, `aria-labelledby` and
 * `onScroll` — are forwarded to the scroller instead, because they describe the region
 * that actually scrolls.
 *
 * Composition: there is no `fade` boolean. The fade exists when — and only when — a
 * `<FadeScrollArea.Fade>` slot is rendered inside, and WHICH edges fade is that part's
 * `position` string (`end | both`). No slot, no mask.
 *
 * ## Orientation
 *
 * `orientation` is an explicit `vertical | horizontal` variant on the ROOT (the
 * `sheetVariants.side` / `Separator.orientation` idiom), not a `horizontal` boolean:
 * the two are alternatives, and a boolean pair could encode "both", which this
 * component cannot be — one scroll container, one axis, one mask direction.
 *
 * The axis is a single decision that four things read: the measurement
 * (`scrollTop/scrollHeight/clientHeight` vs `scrollLeft/scrollWidth/clientWidth`), the
 * gradient direction (`to bottom` vs `to right`), the root's flex direction, and which
 * overflow the viewport takes. Everything else — the `--fade-scroll-length` property,
 * the focus ring on the unmasked root, the scrollable-gated region a11y, the
 * no-active-edge-no-mask rule — is axis-independent and is shared verbatim.
 *
 * Hence the edge vocabulary is axis-NEUTRAL: `start`/`end`, not `top`/`bottom`. One
 * name per edge across both axes; `position="end"` means "the edge you scroll toward"
 * on whichever axis the root declared.
 *
 * Known limitation, documented rather than solved: in an RTL writing mode `scrollLeft`
 * runs negative (or inverted, depending on engine), so the horizontal start/end
 * computation would be mirrored. The product is `cs`-only, so there is no RTL surface
 * to be wrong on today. A future RTL locale must normalise the offset here, not at the
 * call sites.
 *
 * Note for callers that scroll BOTH ways (`panels/bom-table.tsx`): a single explicit
 * overflow makes CSS promote the untouched axis from `visible` to `auto`, so the
 * vertical default already gives a two-axis scroller. That is why neither branch sets
 * both axes explicitly — doing so would silently kill that table's sideways scroll.
 */

type FadeOrientation = "vertical" | "horizontal";

type FadePosition = "end" | "both";

type FadeScrollAreaContextValue = {
  /** Fade slot handshake: `null` unregisters, so unmounting the slot removes the mask. */
  readonly setFadePosition: (position: FadePosition | null) => void;
  /**
   * The axis the root declared. It rides the context so the axis has exactly ONE
   * writer for the whole compound: a part that needs to reason about edges reads it
   * here instead of taking an `orientation` prop of its own, which is how a slot and
   * its root end up disagreeing about which edge is "end".
   */
  readonly orientation: FadeOrientation;
};

const FadeScrollAreaContext = React.createContext<FadeScrollAreaContextValue | null>(null);

function useFadeScrollAreaGuard(part: string): FadeScrollAreaContextValue {
  const ctx = React.use(FadeScrollAreaContext);
  if (!ctx) {
    throw new Error(`<FadeScrollArea.${part}> must be rendered inside <FadeScrollArea>.`);
  }
  return ctx;
}

/** 1px slack absorbs fractional scroll offsets from zoom/DPR so the end state latches. */
const EDGE_EPSILON = 1;

/** `start` is the edge you scroll AWAY from, `end` the one you scroll TOWARD — on either axis. */
type EdgeState = { readonly start: boolean; readonly end: boolean };

const NO_EDGES: EdgeState = { start: false, end: false };

type FadeScrollAreaProps = React.ComponentProps<"div"> & {
  orientation?: FadeOrientation;
};

function FadeScrollAreaRoot({
  className,
  children,
  ref,
  role,
  tabIndex,
  onScroll,
  orientation = "vertical",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: FadeScrollAreaProps) {
  const [fadePosition, setFadePosition] = React.useState<FadePosition | null>(null);
  const [edges, setEdges] = React.useState<EdgeState>(NO_EDGES);
  const [scrollable, setScrollable] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const horizontal = orientation === "horizontal";

  const contextValue = React.useMemo<FadeScrollAreaContextValue>(
    () => ({ setFadePosition, orientation }),
    [orientation],
  );

  const measure = React.useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    // One measurement, read off whichever axis the root declared. `scrollLeft` and
    // `scrollTop` have identical semantics in LTR, so the edge arithmetic below is
    // shared rather than duplicated per branch.
    const offset = horizontal ? node.scrollLeft : node.scrollTop;
    const scrollSize = horizontal ? node.scrollWidth : node.scrollHeight;
    const clientSize = horizontal ? node.clientWidth : node.clientHeight;
    const overflowing = scrollSize - clientSize > EDGE_EPSILON;
    setScrollable(overflowing);
    setEdges(
      overflowing
        ? {
            start: offset > EDGE_EPSILON,
            end: offset + clientSize < scrollSize - EDGE_EPSILON,
          }
        : NO_EDGES,
    );
  }, [horizontal]);

  // Content can grow/shrink without a scroll event (async data, a disclosure opening),
  // so the container AND its children are observed — otherwise the cue goes stale and
  // starts lying in the other direction.
  React.useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, children]);

  // Gate on real EDGE state, not merely on the slot being mounted: with both edges
  // settled the gradient degenerates to `black 0px … black 100%`, a fully-opaque no-op
  // that still forces a compositing layer — and still clips whatever it covers. No
  // active edge, no mask at all.
  const fadeStart = fadePosition === "both" && edges.start;
  const fadeEnd = fadePosition !== null && edges.end;
  const startStop = fadeStart ? "var(--fade-scroll-length)" : "0px";
  const endStop = fadeEnd ? "calc(100% - var(--fade-scroll-length))" : "100%";
  const maskImage =
    fadeStart || fadeEnd
      ? `linear-gradient(to ${horizontal ? "right" : "bottom"}, transparent 0px, black ${startStop}, black ${endStop}, transparent 100%)`
      : undefined;

  // WCAG 2.1.1 / axe `scrollable-region-focusable`: a region that scrolls must be
  // reachable by keyboard, so it takes `tabIndex={0}` — but ONLY while it actually
  // overflows, so a short list does not add a dead tab stop. A focusable region needs
  // an accessible name; `skeleton.tsx` (which exports `Spinner`) is the kit precedent
  // for a Czech default that a caller's prop overrides, so `role="region"` +
  // `aria-label` are defaults here, never overrides.
  const a11y = scrollable
    ? {
        role: role ?? "region",
        tabIndex: tabIndex ?? 0,
        "aria-label": ariaLabelledBy ? ariaLabel : (ariaLabel ?? "Posuvná oblast"),
        "aria-labelledby": ariaLabelledBy,
      }
    : { role, tabIndex, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy };

  return (
    <FadeScrollAreaContext value={contextValue}>
      <div
        data-slot="fade-scroll-area"
        data-orientation={orientation}
        data-fade={fadePosition ?? undefined}
        {...props}
        ref={ref}
        className={cn(
          "has-[:focus-visible]:ring-ring flex [--fade-scroll-length:12px] has-[:focus-visible]:ring-2",
          horizontal ? "min-w-0 flex-row" : "min-h-0 flex-col",
          className,
        )}
      >
        <div
          data-slot="fade-scroll-area-viewport"
          {...a11y}
          ref={viewportRef}
          onScroll={(event) => {
            measure();
            onScroll?.(event);
          }}
          className={cn(
            "flex-1 outline-none",
            // Exactly ONE axis is named per branch; see the note in the doc block on
            // why the other is deliberately left for CSS to promote to `auto`.
            horizontal ? "h-full min-w-0 overflow-x-auto" : "min-h-0 w-full overflow-y-auto",
          )}
          style={{ maskImage, WebkitMaskImage: maskImage }}
        >
          {children}
        </div>
      </div>
    </FadeScrollAreaContext>
  );
}

/**
 * Declarative fade slot — renders nothing, it just tells the enclosing scroll area
 * which edges carry the mask. It is a SLOT rather than a `fade` boolean on the root so
 * the fade reads as part of the composition ("this area fades at its end edge") and so
 * the edge set stays a string union instead of two more booleans.
 *
 * `position` is axis-neutral by design: `end` is the bottom of a vertical area and the
 * right of a horizontal one, so the slot never has to be told which axis it is on — the
 * root already decided that once.
 */
function FadeScrollAreaFade({ position = "end" }: { position?: FadePosition }) {
  const { setFadePosition } = useFadeScrollAreaGuard("Fade");

  React.useEffect(() => {
    setFadePosition(position);
    return () => setFadePosition(null);
  }, [position, setFadePosition]);

  return null;
}

const FadeScrollArea = Object.assign(FadeScrollAreaRoot, {
  Fade: FadeScrollAreaFade,
});

export { FadeScrollArea };
