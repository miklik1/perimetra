import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FAMILY_GLYPHS, FamilyGlyph, type FamilyGlyphName } from "./family-glyph";

const NAMES = Object.keys(FAMILY_GLYPHS) as FamilyGlyphName[];

/**
 * The exhaustiveness proof, at the TYPE level: this map must name every member of
 * the union, so adding a family to the registry without covering it here fails
 * `check-types` rather than silently rendering a blank box. The values are the
 * Czech labels the canvas gives each family (`frames-flow.jsx:125-132`).
 */
const CZECH_LABELS: Record<FamilyGlyphName, string> = {
  posuvna: "Brána posuvná",
  kridlova: "Brána křídlová",
  samonosna: "Samonosná brána",
  branka: "Branka",
  panel: "Plotový panel",
};

/**
 * Shape counts pinned against the source of truth
 * (`design/configurator/frames-flow.jsx:100-123`) — a dropped picket or a lost
 * ground line is the drift this asserts against.
 */
const SHAPE_COUNTS: Record<FamilyGlyphName, number> = {
  posuvna: 12, // rect + bars(…,9,…) + the cantilever path + the ground line
  kridlova: 10, // 2 leaf rects + bars(…,4,…) x2
  branka: 5, // rect + bars(…,3,…) + the handle dot
  panel: 5, // rect + 2 rails + 2 legs
  samonosna: 11, // rect + bars(…,8,…) + the counterweight tail + the roller chevron
};

describe("FamilyGlyph", () => {
  it("consolidates the canvas's three divergent copies into one registry with full case coverage (§8.1)", () => {
    // Pinned deliberately: the flow export is the only copy that implements all
    // five families. Mobile is missing `samonosna` and Katalog maps it onto
    // `posuvna` — neither fallback is reproduced here.
    expect(NAMES).toHaveLength(5);
    expect(new Set(NAMES)).toEqual(new Set(Object.keys(CZECH_LABELS)));
    expect(NAMES).toContain("samonosna");
  });

  it("makes an unknown family a TYPE ERROR, not a blank box", () => {
    // The proof is the `@ts-expect-error` itself: if `name` ever widened to
    // `string`, the directive would become unused and `check-types` would fail on
    // THIS line. `pletivo` is the canvas's sixth Katalog family
    // (`frames-catalog.jsx:36`), which this registry deliberately does not carry
    // a glyph for — so it must not compile.
    // @ts-expect-error — `pletivo` is not a registered family glyph.
    const unregistered = <FamilyGlyph name="pletivo" />;
    expect(unregistered).toBeDefined();

    // The registry is the single gate on that: no key, no fallback entry. All
    // three canvas copies quietly draw a generic rectangle instead, which is the
    // drift §8.1 asks us to delete.
    expect(FAMILY_GLYPHS).not.toHaveProperty("pletivo");
  });

  it("renders at the canvas viewBox and the identity stroke weight", () => {
    render(<FamilyGlyph name="posuvna" data-testid="glyph" />);
    const svg = screen.getByTestId("glyph");

    expect(svg).toHaveAttribute("viewBox", "0 0 96 64");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    // 2.2, NOT the 2.4 the mobile and catalog copies drifted to.
    expect(svg).toHaveAttribute("stroke-width", "2.2");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    expect(svg).toHaveAttribute("fill", "none");
  });

  it("renders every name in the union as a non-empty svg at the right viewBox", () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<FamilyGlyph name={name} />);
      const svg = container.querySelector("svg");

      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("viewBox", "0 0 96 64");
      expect(svg).toHaveAttribute("data-family", name);
      // Non-empty: no family may fall through to an empty (or bare-rectangle) box.
      expect(svg?.children.length).toBe(SHAPE_COUNTS[name]);
      expect(svg?.children.length).toBeGreaterThan(1);

      unmount();
    }
  });

  it("ports the picket spacing maths verbatim — inclusive ends, un-rounded gaps", () => {
    // `bars(20, 76, 9, 24, 46)` on posuvna: gap 7, first at 20, last at 76.
    const { container, unmount } = render(<FamilyGlyph name="posuvna" />);
    const posuvnaBars = [...container.querySelectorAll("line")].filter(
      (l) => l.getAttribute("opacity") === "0.6",
    );

    expect(posuvnaBars).toHaveLength(9);
    expect(posuvnaBars.map((l) => l.getAttribute("x1"))).toEqual([
      "20",
      "27",
      "34",
      "41",
      "48",
      "55",
      "62",
      "69",
      "76",
    ]);
    expect(posuvnaBars[0]).toHaveAttribute("y1", "24");
    expect(posuvnaBars[0]).toHaveAttribute("y2", "46");
    unmount();

    // `bars(18, 40, 4, …)` on kridlova spaces over 22 units — 7.333…, which the
    // canvas leaves un-rounded. Rounding it would be a redraw, not a port.
    const kridlova = render(<FamilyGlyph name="kridlova" />);
    const leafBars = [...kridlova.container.querySelectorAll("line")];

    expect(leafBars).toHaveLength(8);
    expect(Number(leafBars[1]?.getAttribute("x1"))).toBeCloseTo(18 + 22 / 3, 10);
    expect(Number(leafBars[3]?.getAttribute("x1"))).toBe(40);
  });

  it("keeps the per-element opacities that give the set its depth", () => {
    const { container } = render(<FamilyGlyph name="posuvna" />);

    // The cantilever hook at 0.7 and the ground line at 0.3 — both distinct from
    // the 0.6 pickets, and neither is a stroke-weight substitute.
    expect(container.querySelector("path")).toHaveAttribute("opacity", "0.7");
    const ground = [...container.querySelectorAll("line")].find(
      (l) => l.getAttribute("opacity") === "0.3",
    );
    expect(ground).toBeDefined();
    expect(ground).toHaveAttribute("x1", "6");
    expect(ground).toHaveAttribute("x2", "90");
  });

  it("fills only the branka handle — everything else is a stroke", () => {
    const { container } = render(<FamilyGlyph name="branka" />);
    const dot = container.querySelector("circle");

    expect(dot).toHaveAttribute("fill", "currentColor");
    expect(dot).toHaveAttribute("r", "1.6");
    // It must INHERIT the root stroke, never suppress it: the canvas mark is
    // filled and stroked at 2.2, so an explicit stroke="none" would render it
    // at 59% of its authored diameter (README §8.1 — the stroke is the identity).
    expect(dot).not.toHaveAttribute("stroke");
  });

  it("defaults to the canvas's 96x64 and scales on the 3:2 ratio", () => {
    const { rerender } = render(<FamilyGlyph name="panel" data-testid="glyph" />);
    expect(screen.getByTestId("glyph")).toHaveAttribute("width", "96");
    expect(screen.getByTestId("glyph")).toHaveAttribute("height", "64");

    rerender(<FamilyGlyph name="panel" size={48} data-testid="glyph" />);
    expect(screen.getByTestId("glyph")).toHaveAttribute("width", "48");
    expect(screen.getByTestId("glyph")).toHaveAttribute("height", "32");
  });

  it("is decorative by default but becomes a labelled image when named", () => {
    // Derived from aria-label rather than taken as a `decorative` boolean, so the
    // two can never contradict each other (same rule as the kit's Icon).
    const { rerender } = render(<FamilyGlyph name="samonosna" data-testid="glyph" />);
    expect(screen.getByTestId("glyph")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("glyph")).not.toHaveAttribute("role");

    rerender(
      <FamilyGlyph name="samonosna" aria-label={CZECH_LABELS.samonosna} data-testid="glyph" />,
    );
    const labelled = screen.getByTestId("glyph");
    expect(labelled).toHaveAttribute("role", "img");
    expect(labelled).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("img", { name: "Samonosná brána" })).toBe(labelled);
  });

  it("takes the accessible name from aria-labelledby too", () => {
    render(
      <>
        <span id="fam">Brána křídlová</span>
        <FamilyGlyph name="kridlova" aria-labelledby="fam" data-testid="glyph" />
      </>,
    );

    const svg = screen.getByTestId("glyph");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).not.toHaveAttribute("aria-hidden");
  });

  it("never relies on the native title attribute for meaning (design/README.md §12.2)", () => {
    render(<FamilyGlyph name="branka" aria-label={CZECH_LABELS.branka} data-testid="glyph" />);
    expect(screen.getByTestId("glyph").querySelector("title")).toBeNull();
    expect(screen.getByTestId("glyph")).not.toHaveAttribute("title");
  });

  it("merges the caller's className over the shrink guard", () => {
    render(<FamilyGlyph name="posuvna" className="text-copper opacity-60" data-testid="glyph" />);
    expect(screen.getByTestId("glyph")).toHaveClass("shrink-0", "text-copper", "opacity-60");
  });
});
