"use client";

import { useTranslations } from "@repo/i18n/web";
import { FadeScrollArea, StepNav } from "@repo/ui";

import type { RailItem } from "./steps-rail";

/**
 * The tablet band's horizontal step chips (design/configurator/frames-v2.jsx:375-378).
 *
 * A SEPARATE component from {@link import("./steps-rail").StepsRail} rather than
 * an `orientation` prop on it. The two are different layouts of the same data,
 * and the call site already knows which band it is rendering — an orientation
 * boolean would put that decision inside a component that has no way to be right
 * about it, and would grow the prop list the composition mandate exists to keep
 * flat. They share `RailItem`, so the root computes the step list exactly once.
 *
 * It reuses the kit's `StepNav` (flipped to a row via `className`, which
 * `twMerge` resolves against the component's own `flex-col`) so the dots,
 * ordinals, done state, `aria-current` and keyboard behaviour are the SAME
 * implementation the vertical rail uses. A hand-rolled chip row would be a
 * second place for the step semantics to drift.
 *
 * The canvas row is `overflow: hidden`, which silently truncates once a release
 * authors more steps than fit — the §8.2 tablet question "whether the chip row
 * scrolls when steps overflow". It scrolls, because the step count is
 * release-authored and therefore unbounded.
 *
 * ⚠️ It scrolls WITHOUT the masked-edge fade §8.1 codifies. The kit's
 * `FadeScrollArea` is vertical-only — its `Fade` slot takes `bottom | both` and
 * its viewport is `overflow-y-auto` — so there is no horizontal variant to
 * compose, and §8.1 explicitly forbids re-implementing the gradient locally.
 * The scroll region is still named and keyboard-reachable; only the visual cue
 * is missing. Closing it means a horizontal orientation on the kit component,
 * which is a `packages/ui` change and is left for its own slice.
 */
export function StepChips({
  items,
  activeKey,
  onSelect,
}: {
  items: RailItem[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  const t = useTranslations("configurator");

  return (
    // `FadeScrollArea` without a `Fade` slot: no mask (the kit has none for this
    // axis — see above), but the scroller is the kit's, so this row is not a
    // second local scroll implementation.
    //
    // Deliberately NO forced `role="region"` / `tabIndex` here, unlike
    // `panels/bom-table.tsx`. That table's cells are inert, so its scroll
    // container needs its own tab stop to be reachable (WCAG 2.1.1). Every chip
    // in THIS row is a focusable button, and tabbing to one scrolls it into
    // view — the region is already keyboard-operable through its contents. A
    // forced tab stop would add a dead one in the common case where the row
    // fits, and a second landmark sharing the nav's name over the same controls.
    <FadeScrollArea className="bg-chrome border-border flex-none border-b">
      <StepNav
        aria-label={t("configuration")}
        value={activeKey}
        onValueChange={onSelect}
        // NO `w-max` here. `StepNav`'s root carries `@container/step-nav`, which
        // is `container-type: inline-size` — and an inline-size container sizes
        // itself from its own content, so `w-max` collapsed the nav's measured
        // box to ~32px. The `@[10rem]/step-nav` query then never matched: every
        // chip rendered as a bare numbered dot with its label stuck in `sr-only`,
        // and the row could not scroll. Tests stayed green throughout, because
        // the accessible name survives in `sr-only` — only sighted users lost the
        // step names, at the touch-first band. Let the nav fill the row instead.
        className="flex-row gap-2 px-4 py-2.5"
      >
        {items.map((item) => (
          <StepNav.Item
            key={item.key}
            value={item.key}
            state={item.done ? "done" : undefined}
            // Coarse-pointer target (§12.1 item 5) — this band is touch-first.
            className="pointer-coarse:min-h-11 flex-none"
          >
            <StepNav.Label>{item.label}</StepNav.Label>
          </StepNav.Item>
        ))}
      </StepNav>
    </FadeScrollArea>
  );
}
