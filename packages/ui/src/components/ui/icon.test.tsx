import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Icon, ICON_PATHS, type IconName } from "./icon";

const NAMES = Object.keys(ICON_PATHS) as IconName[];

describe("Icon", () => {
  it("ports the canvas registry verbatim — 20 glyphs at the identity stroke weight (ADR 0114)", () => {
    // The count is pinned deliberately: the export declares exactly 20 UI
    // glyphs (design/configurator/parts.jsx:16-37). A silent drop or a
    // hand-added 21st is the drift this asserts against.
    expect(NAMES).toHaveLength(20);

    render(<Icon name="draft" data-testid="glyph" />);
    const svg = screen.getByTestId("glyph");

    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "1.7");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    expect(svg).toHaveAttribute("fill", "none");
  });

  it("renders every registered glyph's full path set", () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const paths = container.querySelectorAll("path");

      expect(paths).toHaveLength(ICON_PATHS[name].length);
      expect([...paths].map((p) => p.getAttribute("d"))).toEqual([...ICON_PATHS[name]]);
      unmount();
    }
  });

  it("defaults to 18px and scales to the caller's size on both axes", () => {
    const { rerender } = render(<Icon name="cube" data-testid="glyph" />);
    expect(screen.getByTestId("glyph")).toHaveAttribute("width", "18");
    expect(screen.getByTestId("glyph")).toHaveAttribute("height", "18");

    rerender(<Icon name="cube" size={26} data-testid="glyph" />);
    expect(screen.getByTestId("glyph")).toHaveAttribute("width", "26");
    expect(screen.getByTestId("glyph")).toHaveAttribute("height", "26");
  });

  it("is decorative by default but becomes a labelled image when named", () => {
    // Derived from aria-label rather than taken as a `decorative` boolean, so
    // the two can never contradict each other.
    const { rerender } = render(<Icon name="warn" data-testid="glyph" />);
    expect(screen.getByTestId("glyph")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("glyph")).not.toHaveAttribute("role");

    rerender(<Icon name="warn" aria-label="Varování" data-testid="glyph" />);
    const labelled = screen.getByTestId("glyph");
    expect(labelled).toHaveAttribute("role", "img");
    expect(labelled).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("img", { name: "Varování" })).toBe(labelled);
  });

  it("takes the accessible name from aria-labelledby too", () => {
    render(
      <>
        <span id="lbl">Zamčeno</span>
        <Icon name="lock" aria-labelledby="lbl" data-testid="glyph" />
      </>,
    );

    const svg = screen.getByTestId("glyph");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).not.toHaveAttribute("aria-hidden");
  });

  it("never relies on the native title attribute for meaning (design/README.md §12.2)", () => {
    render(<Icon name="reproduce" aria-label="Ověřit reprodukovatelnost" data-testid="glyph" />);
    expect(screen.getByTestId("glyph").querySelector("title")).toBeNull();
    expect(screen.getByTestId("glyph")).not.toHaveAttribute("title");
  });

  it("merges the caller's className over the shrink guard", () => {
    render(<Icon name="chevron" className="text-copper rotate-90" data-testid="glyph" />);
    expect(screen.getByTestId("glyph")).toHaveClass("shrink-0", "text-copper", "rotate-90");
  });
});
