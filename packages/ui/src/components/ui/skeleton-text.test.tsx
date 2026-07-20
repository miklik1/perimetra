import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Skeleton } from "./skeleton";
import { SkeletonText } from "./skeleton-text";

vi.mock("./skeleton", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skeleton")>();
  return { ...actual, Skeleton: vi.fn(actual.Skeleton) };
});

function lines(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-slot="skeleton-text-line"]'));
}

describe("SkeletonText", () => {
  it("generates three lines by default", () => {
    render(<SkeletonText data-testid="st" />);
    const root = screen.getByTestId("st");

    expect(root).toHaveAttribute("data-slot", "skeleton-text");
    expect(lines(root)).toHaveLength(3);
  });

  it("cuts only the LAST line short so the block reads as a paragraph", () => {
    render(<SkeletonText lines={4} data-testid="st" />);
    const bars = lines(screen.getByTestId("st"));

    expect(bars.slice(0, 3).map((bar) => bar.style.width)).toEqual(["", "", ""]);
    expect(bars[3]?.style.width).toBe("60%");
  });

  it("leaves a single line full width — one stub reads as a label, not a paragraph", () => {
    render(<SkeletonText lines={1} data-testid="st" />);
    const bars = lines(screen.getByTestId("st"));

    expect(bars).toHaveLength(1);
    expect(bars[0]?.style.width).toBe("");
  });

  it("cycles an explicit width pattern and thereby replaces the short-last default", () => {
    render(<SkeletonText lines={5} widths={["100%", "80%"]} data-testid="st" />);

    expect(lines(screen.getByTestId("st")).map((bar) => bar.style.width)).toEqual([
      "100%",
      "80%",
      "100%",
      "80%",
      "100%",
    ]);
  });

  it("renders composed children instead of generated lines when the slot is filled", () => {
    render(
      <SkeletonText lines={9} data-testid="st">
        <SkeletonText.Line className="h-8" />
        <SkeletonText.Line style={{ width: "40%" }} />
      </SkeletonText>,
    );
    const bars = lines(screen.getByTestId("st"));

    expect(bars).toHaveLength(2);
    expect(bars[1]?.style.width).toBe("40%");
  });

  it("falls back to generated lines when a conditional child yields `false`", () => {
    const ready = false;
    render(
      <SkeletonText lines={2} data-testid="st">
        {ready && <SkeletonText.Line />}
      </SkeletonText>,
    );

    expect(lines(screen.getByTestId("st"))).toHaveLength(2);
  });

  it("falls back to generated lines when a mapped child list is empty", () => {
    const items: string[] = [];
    render(
      <SkeletonText lines={2} data-testid="st">
        {items.map((item) => (
          <SkeletonText.Line key={item} />
        ))}
      </SkeletonText>,
    );

    expect(lines(screen.getByTestId("st"))).toHaveLength(2);
  });

  it("honours an explicitly EMPTY width pattern instead of re-enabling the default", () => {
    render(<SkeletonText lines={3} widths={[]} data-testid="st" />);
    const bars = lines(screen.getByTestId("st"));

    expect(bars).toHaveLength(3);
    expect(bars.map((bar) => bar.style.width)).toEqual(["", "", ""]);
  });

  it("is hidden from assistive tech — announcing the load is the caller's region, not this", () => {
    render(<SkeletonText data-testid="st" />);

    expect(screen.getByTestId("st")).toHaveAttribute("aria-hidden", "true");
  });

  it("composes the shared Skeleton pulse rather than reimplementing it", () => {
    // Asserting the pulse CLASSES would pass just as well on a hand-rolled div —
    // i.e. on exactly the reimplementation this test exists to forbid. Pin the
    // relationship instead: one real `Skeleton` element per generated line.
    vi.mocked(Skeleton).mockClear();
    render(<SkeletonText lines={3} />);

    expect(vi.mocked(Skeleton)).toHaveBeenCalledTimes(3);
  });

  it("throws a branded error when a Line is rendered outside a SkeletonText", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<SkeletonText.Line />)).toThrow(
      "<SkeletonText.Line> must be rendered inside <SkeletonText>.",
    );

    spy.mockRestore();
  });
});
