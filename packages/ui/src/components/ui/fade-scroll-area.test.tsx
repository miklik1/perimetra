import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FadeScrollArea } from "./fade-scroll-area";

/**
 * jsdom has no layout, so every geometry read is 0 and the area is never
 * "overflowing" by default. These helpers install a fake scroll geometry on the
 * viewport node and then dispatch a scroll so the component re-measures — which is
 * exactly the path the browser takes.
 */
function setGeometry(
  node: HTMLElement,
  geometry: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  for (const [key, value] of Object.entries(geometry)) {
    Object.defineProperty(node, key, { value, configurable: true, writable: true });
  }
  fireEvent.scroll(node);
}

/** The caller's element: className/style/ref and the focus ring live here. */
const root = () => screen.getByTestId("area");

/** The masked scroll viewport: overflow, the mask and the region a11y live here. */
const viewport = () => {
  const node = root().querySelector<HTMLElement>("[data-slot='fade-scroll-area-viewport']");
  if (!node) throw new Error("viewport not rendered");
  return node;
};

const mask = () => viewport().style.maskImage;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FadeScrollArea", () => {
  it("is a real scroll container, not the canvas's overflow:hidden fake", () => {
    render(<FadeScrollArea data-testid="area">obsah</FadeScrollArea>);

    expect(root()).toHaveAttribute("data-slot", "fade-scroll-area");
    expect(viewport()).toHaveClass("overflow-y-auto");
  });

  it("exposes the canvas's 12px fade length as an overridable custom property", () => {
    render(<FadeScrollArea data-testid="area">obsah</FadeScrollArea>);

    expect(root()).toHaveClass("[--fade-scroll-length:12px]");
  });

  it("applies no mask at all when no Fade slot is composed in", () => {
    render(<FadeScrollArea data-testid="area">obsah</FadeScrollArea>);
    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });

    expect(mask()).toBe("");
    expect(root()).not.toHaveAttribute("data-fade");
  });

  it("fades the bottom edge only while there is content still below the fold", () => {
    render(
      <FadeScrollArea data-testid="area">
        <FadeScrollArea.Fade />
        <div>obsah</div>
      </FadeScrollArea>,
    );

    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    expect(root()).toHaveAttribute("data-fade", "bottom");
    expect(mask()).toContain("calc(100% - var(--fade-scroll-length))");
  });

  it("records the composed edge set on data-fade for position=both", () => {
    render(
      <FadeScrollArea data-testid="area">
        <FadeScrollArea.Fade position="both" />
        <div>obsah</div>
      </FadeScrollArea>,
    );

    expect(root()).toHaveAttribute("data-fade", "both");
  });

  it("drops the mask entirely at the very end so the last row never looks cut off", () => {
    render(
      <FadeScrollArea data-testid="area">
        <FadeScrollArea.Fade />
        <div>obsah</div>
      </FadeScrollArea>,
    );

    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
    // No edge is active, so rather than painting a degenerate fully-opaque gradient
    // (a pointless compositing layer that still clips) there is no mask at all.
    expect(mask()).toBe("");
  });

  it("fades the top edge too, but only once scrolled away from it, with position=both", () => {
    render(
      <FadeScrollArea data-testid="area">
        <FadeScrollArea.Fade position="both" />
        <div>obsah</div>
      </FadeScrollArea>,
    );

    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    expect(mask()).toContain("black 0px");
    expect(mask()).not.toContain("black var(--fade-scroll-length)");

    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 200 });
    expect(mask()).toContain("black var(--fade-scroll-length)");
  });

  it("degrades to no mask rather than to clipped content when ResizeObserver is missing", () => {
    vi.stubGlobal("ResizeObserver", undefined);

    render(
      <FadeScrollArea data-testid="area">
        <FadeScrollArea.Fade position="both" />
        <div>obsah</div>
      </FadeScrollArea>,
    );

    // Mount-time measure() still runs (it precedes the ResizeObserver bail), and with
    // no measurable overflow no edge is active — so nothing is masked and the content
    // stays fully visible.
    expect(mask()).toBe("");
    expect(screen.getByText("obsah")).toBeVisible();

    // And a scroll still re-measures without any observer.
    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    expect(mask()).toContain("calc(100% - var(--fade-scroll-length))");
  });

  it("paints the focus ring on the unmasked root, never on the masked viewport", () => {
    // A mask clips and alpha-modulates everything its element paints, box-shadow rings
    // and outlines included (verified in headless Chromium). So the indicator has to
    // sit on an ancestor the mask cannot reach.
    render(
      <FadeScrollArea data-testid="area">
        <FadeScrollArea.Fade />
        <div>obsah</div>
      </FadeScrollArea>,
    );
    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });

    expect(root()).toHaveClass("has-[:focus-visible]:ring-2");
    expect(root()).not.toHaveClass("focus-visible:ring-2");
    expect(viewport()).toHaveClass("outline-none");
    expect(viewport().style.maskImage).not.toBe("");
  });

  it("becomes a named, keyboard-reachable region only while it actually scrolls", () => {
    render(
      <FadeScrollArea data-testid="area">
        <FadeScrollArea.Fade />
        <div>obsah</div>
      </FadeScrollArea>,
    );

    expect(screen.queryByRole("region")).toBeNull();
    expect(viewport()).not.toHaveAttribute("tabindex");

    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    const region = screen.getByRole("region", { name: "Posuvná oblast" });
    expect(region).toBe(viewport());
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("lets the caller override the default region name", () => {
    render(
      <FadeScrollArea data-testid="area" aria-label="Seznam nabídek">
        <FadeScrollArea.Fade />
      </FadeScrollArea>,
    );
    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });

    expect(screen.getByRole("region", { name: "Seznam nabídek" })).toBe(viewport());
  });

  it("keeps the caller's className and ref on the root they size", () => {
    const ref = vi.fn();
    render(
      <FadeScrollArea data-testid="area" className="max-h-64" ref={ref}>
        obsah
      </FadeScrollArea>,
    );

    expect(root()).toHaveClass("max-h-64");
    expect(ref).toHaveBeenCalledWith(root());
  });

  it("calls the caller's own onScroll alongside its measurement", () => {
    const onScroll = vi.fn();
    render(
      <FadeScrollArea data-testid="area" onScroll={onScroll}>
        obsah
      </FadeScrollArea>,
    );

    fireEvent.scroll(viewport());
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("removes the mask again when the Fade slot unmounts", () => {
    const { rerender } = render(
      <FadeScrollArea data-testid="area">
        <FadeScrollArea.Fade />
        <div>obsah</div>
      </FadeScrollArea>,
    );
    setGeometry(viewport(), { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    expect(mask()).not.toBe("");

    rerender(
      <FadeScrollArea data-testid="area">
        <div>obsah</div>
      </FadeScrollArea>,
    );
    expect(mask()).toBe("");
  });

  it("throws a clear error when Fade is rendered outside <FadeScrollArea>", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<FadeScrollArea.Fade />)).toThrow(
      "<FadeScrollArea.Fade> must be rendered inside <FadeScrollArea>.",
    );
    spy.mockRestore();
  });
});
