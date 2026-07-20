"use client";

import { useTranslations } from "@repo/i18n/web";
import { FadeScrollArea, StepNav } from "@repo/ui";

/**
 * The configurator's vertical steps rail (design/configurator/frames-v2.jsx:177-195,
 * the `stepsRail()` frame).
 *
 * PURELY PRESENTATIONAL. The wizard root owns the flow — which steps exist, which
 * are complete, what each one's value echo says — and hands this component a
 * flat, already-resolved list. The rail decides nothing: it does not read the
 * release, does not format values and does not derive completeness. That keeps
 * the single source of step truth in `wizard-flow.ts` rather than splitting it
 * across a nav that could disagree with the panel beside it.
 *
 * ## Why the items are data and the steps are composition
 *
 * `items` is a list rather than `<StepsRail.Item>` children because the step set
 * is DERIVED (release-authored steps wrapped by three shell steps — see
 * `BrandStep`), not hand-written per screen: there is no call site that would
 * spell the steps out, so children would only re-serialise a loop. Inside, each
 * item still renders through the kit's compound (`StepNav.Item` +
 * `.Label` + `.Sub`), so the per-step CONTENT stays a composition and this file
 * never re-implements a dot, an ordinal or an active style.
 *
 * ## What is deliberately absent
 *
 * - **`locked`.** The canvas draws a "Motorizace / Připravujeme" step with a lock
 *   glyph and a `V1` badge. No data model carries availability, so `RailItem` has
 *   no `locked` field — inventing one here would mean every call site computing a
 *   value nothing can source. The kit supports `state="locked"` when a model for
 *   it exists.
 * - **A density prop.** The canvas switches between a 210px labelled rail and a
 *   60px dot rail with a `compact` boolean. `StepNav` collapses itself on a
 *   container query instead, so there is no branch here and no boolean to keep in
 *   sync. See the width note below.
 * - **`active`.** Derived by `StepNav` from the root `value`, so the rail cannot
 *   contradict itself about where the user is.
 *
 * The rail is a fixed-width (`flex-none`) full-height column: the step list
 * scrolls inside it via `FadeScrollArea` (§8.1's masked-edge cue, which is a real
 * scroll container — the gradient is never re-implemented locally), while the
 * "Konfigurace" caption stays pinned above it.
 */

export interface RailItem {
  /** `flowKey(step)` — the value `StepNav` matches against `activeKey`. */
  key: string;
  /** Resolved for display: i18n for shell steps, the authored label for release steps. */
  label: string;
  /** The step's value echo ("4 000 × 1 800"); omitted when there is nothing to echo. */
  sub?: string;
  done: boolean;
}

export function StepsRail({
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
    <StepNav
      value={activeKey}
      onValueChange={onSelect}
      aria-label={t("configuration")}
      className="bg-chrome border-border h-full w-[210px] flex-none border-r px-3 py-3.5"
    >
      <StepNav.Heading>{t("configuration")}</StepNav.Heading>
      {/*
       * `min-h-0` + `flex-1`: the rail is as tall as the shell, so the list — not
       * the page — is what scrolls when a release authors more steps than fit.
       */}
      <FadeScrollArea className="min-h-0 flex-1">
        <FadeScrollArea.Fade position="both" />
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <StepNav.Item key={item.key} value={item.key} state={item.done ? "done" : undefined}>
              <StepNav.Label>{item.label}</StepNav.Label>
              {/*
               * The echo is supplementary, never the sole carrier: it lives INSIDE
               * the item's accessible name alongside the label, so a step reads as
               * "Rozměry 4 000 × 1 800" at every width — including collapsed, where
               * the whole subtree becomes visually hidden but keeps naming the dot.
               */}
              {item.sub === undefined ? null : <StepNav.Sub>{item.sub}</StepNav.Sub>}
            </StepNav.Item>
          ))}
        </div>
      </FadeScrollArea>
    </StepNav>
  );
}
