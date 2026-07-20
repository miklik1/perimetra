import * as React from "react";

import { cn } from "@repo/ui";

/**
 * The Perimetra product-family glyph registry — the 96 x 64 set, ported
 * VERBATIM from `design/configurator/frames-flow.jsx:94-124` (ADR 0114).
 *
 * The stroke weight IS the identity — `2.2` at a 96 x 64 viewBox with round caps
 * and joins, and the per-element opacities (0.3 / 0.5 / 0.6 / 0.7) that give the
 * set its depth. Do NOT substitute Lucide (or any other set) equivalents, and do
 * not redraw or "tidy" a coordinate: the whole set reads as one hand
 * (`design/README.md` §8.1).
 *
 * ## Why this file exists
 *
 * §8.1 records the family glyphs as an explicit CONSOLIDATION work item: the
 * canvas export carries THREE divergent copies with different case coverage and
 * different stroke weights —
 *
 * - `frames-flow.jsx:94-124`   — stroke 2.2, all five cases. THE SOURCE OF TRUTH.
 * - `frames-mobile.jsx:69-86`  — stroke 2.4, and `samonosna` is MISSING (it falls
 *                                through to a plain rectangle at `:84`).
 * - `frames-catalog.jsx:39-47` — stroke 2.4, and `samonosna` is mapped onto
 *                                `posuvna`.
 *
 * This is the one registry, at the one stroke weight, with full case coverage.
 * The two divergent copies are reference bytes only and were not ported from.
 *
 * ## Why app-land and not `@repo/ui`
 *
 * §9.2 assigns the family glyphs to `apps/web`: a gate family is Perimetra
 * product vocabulary, whereas the 20-glyph UI `Icon` set is domain-agnostic and
 * belongs to the kit. Do not move this into `@repo/ui`.
 *
 * Geometry is reference bytes. When the canvas export is refreshed (§1.3), this
 * registry is re-derived from `frames-flow.jsx` rather than hand-edited.
 */

/**
 * A drawable primitive. `dot` is the only filled shape in the whole set (the
 * branka handle); everything else is a stroke against `fill: none`.
 */
type GlyphShape =
  | {
      readonly el: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
      readonly opacity?: number;
    }
  | {
      readonly el: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly opacity?: number;
    }
  | { readonly el: "path"; readonly d: string; readonly opacity?: number }
  | { readonly el: "dot"; readonly cx: number; readonly cy: number; readonly r: number };

/**
 * The infill picket run — the canvas `bars(x0, x1, n, y0, y1)` helper, spacing
 * maths and all. The gap is `(x1 - x0) / (n - 1)`, so the run is INCLUSIVE of
 * both ends and the intermediate x-values are deliberately left un-rounded:
 * `kridlova` spaces four bars over 22 units (7.333…) and `samonosna` eight over
 * 52 (7.428…). Rounding them would be a redraw, not a port.
 */
function bars(x0: number, x1: number, n: number, y0: number, y1: number): GlyphShape[] {
  const gap = (x1 - x0) / (n - 1);

  return Array.from({ length: n }, (_, i) => ({
    el: "line" as const,
    x1: x0 + i * gap,
    y1: y0,
    x2: x0 + i * gap,
    y2: y1,
    opacity: 0.6,
  }));
}

const FAMILY_GLYPHS = {
  posuvna: [
    { el: "rect", x: 14, y: 20, width: 68, height: 30, rx: 2 },
    ...bars(20, 76, 9, 24, 46),
    { el: "path", d: "M14 50 L6 50 L6 44 L14 44", opacity: 0.7 },
    { el: "line", x1: 6, y1: 56, x2: 90, y2: 56, opacity: 0.3 },
  ],
  kridlova: [
    { el: "rect", x: 12, y: 20, width: 34, height: 30, rx: 2 },
    { el: "rect", x: 50, y: 20, width: 34, height: 30, rx: 2 },
    ...bars(18, 40, 4, 24, 46),
    ...bars(56, 78, 4, 24, 46),
  ],
  branka: [
    { el: "rect", x: 34, y: 14, width: 28, height: 40, rx: 2 },
    ...bars(40, 56, 3, 18, 50),
    { el: "dot", cx: 57, cy: 34, r: 1.6 },
  ],
  panel: [
    { el: "rect", x: 12, y: 22, width: 72, height: 26, rx: 2 },
    { el: "line", x1: 12, y1: 30, x2: 84, y2: 30, opacity: 0.5 },
    { el: "line", x1: 12, y1: 40, x2: 84, y2: 40, opacity: 0.5 },
    { el: "line", x1: 20, y1: 48, x2: 20, y2: 56, opacity: 0.6 },
    { el: "line", x1: 76, y1: 48, x2: 76, y2: 56, opacity: 0.6 },
  ],
  samonosna: [
    { el: "rect", x: 16, y: 18, width: 64, height: 30, rx: 2 },
    ...bars(22, 74, 8, 22, 44),
    { el: "path", d: "M16 48 L4 48 L4 40", opacity: 0.7 },
    { el: "path", d: "M12 36 l4 -4 l4 4", opacity: 0.6 },
  ],
} as const satisfies Record<string, readonly GlyphShape[]>;

/**
 * The family names, as a union. An unknown name is a TYPE ERROR rather than a
 * silently blank box — which is why the registry is a const object and not a
 * lookup by string, and why this component has NO default case. The canvas
 * copies all fall through to a plain rectangle for a name they do not implement;
 * that fallback is exactly the drift §8.1 asks us to delete, so it is not
 * reproduced here.
 */
type FamilyGlyphName = keyof typeof FAMILY_GLYPHS;

/** The authored aspect ratio: 96 wide x 64 tall. */
const GLYPH_WIDTH = 96;
const GLYPH_HEIGHT = 64;

type FamilyGlyphProps = Omit<React.ComponentProps<"svg">, "children"> & {
  name: FamilyGlyphName;
  /**
   * Rendered WIDTH in px; height follows the 3:2 canvas ratio. The canvas draws
   * the flow cards at the authored 96, and the mobile/catalog lists smaller —
   * the geometry scales cleanly either way.
   */
  size?: number;
};

/** A stable render key: the shape's own geometry, which is unique within a glyph. */
function shapeKey(shape: GlyphShape): string {
  return Object.entries(shape)
    .map(([k, v]) => `${k}:${String(v)}`)
    .join("|");
}

function renderShape(shape: GlyphShape) {
  const key = shapeKey(shape);

  switch (shape.el) {
    case "rect":
      return (
        <rect
          key={key}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
          opacity={shape.opacity}
        />
      );
    case "line":
      return (
        <line
          key={key}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          opacity={shape.opacity}
        />
      );
    case "path":
      return <path key={key} d={shape.d} opacity={shape.opacity} />;
    case "dot":
      // The one filled shape in the set — the branka handle.
      return (
        <circle
          key={key}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          // Fill ONLY. The canvas circle overrides fill and inherits the root's
          // stroke, so the mark reads r=1.6 plus half of the 2.2 stroke. Adding
          // stroke="none" here shrank the set's one filled accent to 59% of its
          // authored diameter — the exact "tidy-up" README §8.1 forbids.
          fill="currentColor"
        />
      );
  }
}

/**
 * Accessibility: a family glyph is DECORATIVE by default (`aria-hidden`), because
 * it always sits beside its own family label ("Brána posuvná", "Samonosná brána"
 * …). Passing `aria-label` (or `aria-labelledby`) flips it to a meaningful image
 * — derived from the prop rather than taken as a `decorative` boolean, so the two
 * can never contradict each other. Same rule as the kit's `Icon`.
 *
 * Deliberately NOT the native `title` attribute: `design/README.md` §12.2 bans it
 * (invisible to keyboard and touch, and not an accessible name). A glyph-only
 * control gets a real `Tooltip` AND an `aria-label`.
 */
function FamilyGlyph({ name, size = GLYPH_WIDTH, className, ...props }: FamilyGlyphProps) {
  const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;

  return (
    <svg
      data-slot="family-glyph"
      data-family={name}
      viewBox={`0 0 ${GLYPH_WIDTH} ${GLYPH_HEIGHT}`}
      width={size}
      height={Math.round(size * (GLYPH_HEIGHT / GLYPH_WIDTH))}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn("shrink-0", className)}
      {...props}
    >
      {FAMILY_GLYPHS[name].map(renderShape)}
    </svg>
  );
}

export { FamilyGlyph, FAMILY_GLYPHS };
export type { FamilyGlyphName };
