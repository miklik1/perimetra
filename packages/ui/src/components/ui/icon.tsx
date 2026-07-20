import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * The 20-glyph Perimetra UI icon registry, ported VERBATIM from the design
 * canvas export (`design/configurator/parts.jsx:16-37`, ADR 0114).
 *
 * The stroke weight IS the identity — `1.7` at a 24-unit viewBox with round
 * caps and joins. Do NOT substitute Lucide (or any other set) equivalents for
 * these glyphs: the whole set reads as one hand because every path was drawn to
 * that weight, and a 2.0-weight interloper is visible at a glance next to it
 * (`design/README.md` §8.1).
 *
 * Path data is reference bytes. When the canvas export is refreshed (§1.3), this
 * registry is re-derived from `parts.jsx` rather than hand-edited.
 *
 * This is the UI set only. The product-family glyphs are a SEPARATE set — a
 * 96x64 viewBox at stroke 2.2-2.4 — and they live in `apps/web`, because a gate
 * family is Perimetra domain vocabulary and `@repo/ui` stays domain-agnostic
 * (§9.2).
 */
const ICON_PATHS = {
  cube: ["M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z", "M4 7.5l8 4.5 8-4.5", "M12 12v9"],
  draft: ["M6 3h9l3 3v15H6z", "M15 3v3h3", "M9 11h6M9 14h6M9 17h3"],
  list: ["M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"],
  explode: ["M12 3v4M12 17v4M3 12h4M17 12h4", "M9 9l-3-3M15 9l3-3M9 15l-3 3M15 15l3 3"],
  section: ["M4 12h16", "M8 4v16", "M4 4l4 4M20 4l-4 4"],
  center: ["M12 4v3M12 17v3M4 12h3M17 12h3", "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],
  plus: ["M12 5v14M5 12h14"],
  ruler: ["M3 8h18v8H3z", "M7 8v3M11 8v4M15 8v3M19 8v4"],
  palette: [
    "M12 3a9 9 0 1 0 0 18c1.7 0 2-1.5 1.2-2.4-.8-.9-.3-2.1 1-2.1H17a4 4 0 0 0 4-4c0-4.4-4-7.5-9-7.5z",
    "M7.5 12.5h.01M9.5 8.5h.01M14.5 8.5h.01",
  ],
  layers: ["M12 3l9 5-9 5-9-5 9-5z", "M3 13l9 5 9-5", "M3 16l9 5 9-5"],
  post: ["M9 3h6v18H9z", "M9 8h6M9 13h6M9 18h6"],
  pin: [
    "M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z",
    "M12 10m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0",
  ],
  upRight: ["M7 17L17 7", "M8 7h9v9"],
  check: ["M4 12l5 5L20 6"],
  warn: ["M12 3l9 16H3z", "M12 10v4", "M12 17h.01"],
  save: ["M5 3h11l3 3v15H5z", "M8 3v5h7", "M8 14h8v7H8z"],
  chevron: ["M9 5l7 7-7 7"],
  reproduce: ["M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2", "M18 4v5h-5M6 20v-5h5"],
  lock: ["M6 11h12v9H6z", "M9 11V8a3 3 0 0 1 6 0v3"],
  scale: ["M12 3v18", "M7 8L3 15h8zM17 8l-4 7h8z", "M5 8h14"],
} as const;

/**
 * The glyph names, as a union. An unknown name is a TYPE ERROR rather than a
 * silently blank box — which is the whole reason the registry is a const object
 * and not a lookup by string.
 */
type IconName = keyof typeof ICON_PATHS;

type IconProps = Omit<React.ComponentProps<"svg">, "children"> & {
  name: IconName;
  /** Rendered box in px. The canvas default is 18; the registry scales cleanly. */
  size?: number;
};

/**
 * Accessibility: an icon is DECORATIVE by default (`aria-hidden`), because it
 * almost always sits beside its own text label. Passing `aria-label` flips it to
 * a meaningful image — we derive that from the prop rather than taking a
 * `decorative` boolean, so the two can never contradict each other.
 *
 * Note this is deliberately NOT the `title=` attribute. The export ships native
 * `title` tooltips and `design/README.md` §12.2 wires a lint rule banning them:
 * `title` is invisible to keyboard and touch users and is not an accessible
 * name for an interactive control. Where a glyph-only control needs a visible
 * hint, the caller wraps it in a real `Tooltip` AND gives it an `aria-label`.
 */
function Icon({ name, size = 18, className, ...props }: IconProps) {
  const labelled = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;

  return (
    <svg
      data-slot="icon"
      data-icon={name}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn("shrink-0", className)}
      {...props}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export { Icon, ICON_PATHS };
export type { IconName };
