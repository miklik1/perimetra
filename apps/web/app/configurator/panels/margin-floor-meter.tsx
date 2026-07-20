"use client";

import { useId } from "react";

import { useTranslations } from "@repo/i18n/web";
import { cn } from "@repo/ui";

/**
 * The margin-floor gauge (canvas `marginMeter`, design/configurator/frames-v2.jsx:226-235):
 * the real ADR 0059 margin drawn against the org's margin floor, so a rep sees
 * the number the SERVER will judge at `issue` before they get a 422.
 *
 * Visibility is NOT this component's business — it renders whatever it is given.
 * The ADR 0056 price-blind rule and the ADR 0116 admin-only cost rule are both
 * enforced one level up, in `CommercialPanel`, which simply does not render this.
 *
 * ── THE ROUNDING RULE (pinned) ────────────────────────────────────────────────
 * ONE rounding, `Math.round` to whole percent, feeds BOTH the displayed number
 * and the breach comparison. The canvas prints "17 %" for a computed 16.9 %, so
 * the display rounds; if the comparison used the raw value instead, a margin of
 * 24.6 % against a 25 % floor would render as "Marže 25 % · limit 25 %" and still
 * paint itself destructive and raise the breach banner — a state the rep cannot
 * explain and cannot fix. Rounding both sides makes the invariant structural:
 * a value that DISPLAYS as >= the floor never reads as a breach.
 *
 * The server's guard compares un-rounded, so the two can disagree inside half a
 * percentage point. That asymmetry is deliberate and is the safe direction only
 * because the floor is advisory here (the panel states the consequence; it does
 * not gate the action) — do NOT reuse this rounding to decide anything binding.
 *
 * ── THE AXIS RULE ─────────────────────────────────────────────────────────────
 * The canvas hardcodes a 0-50 % axis, which silently clips any org whose floor is
 * above 50 % (the fill and the tick both pin to the right edge and the gauge
 * stops meaning anything). Instead the axis starts at the canvas's 50 — so an
 * ordinary gate margin looks exactly like the design — and grows in 10-point
 * steps until the LARGER of (margin, floor) fits with 25 % headroom, capped at
 * 100. The cap never truncates real data: a margin is (price-cost)/price, which
 * is < 100 % for any positive cost, and a floor above 100 % is not a floor.
 */

/** The canvas axis, kept as the LOWER BOUND of the range rather than as the range. */
const CANVAS_AXIS_MAX = 50;

/** Headroom multiplier + step, so the fill never pins flush to the right edge. */
const AXIS_HEADROOM = 1.25;
const AXIS_STEP = 10;

/** The one rounding — see THE ROUNDING RULE above. */
function roundPct(pct: number): number {
  return Math.round(pct);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return value < 0 ? min : max;
  return Math.min(max, Math.max(min, value));
}

/**
 * Does this margin read as below the floor? Exported because `CommercialPanel`
 * picks its validity line from the SAME predicate the gauge paints itself with —
 * two independent comparisons is exactly how a green "margin above floor" line
 * ends up sitting under a red bar.
 *
 * A non-finite margin is `marginPct`'s documented degenerate case (a zero or
 * negative price against a real cost, i.e. -Infinity) and always breaches.
 */
export function marginBreaches(marginPct: number, floorPct: number): boolean {
  if (!Number.isFinite(marginPct)) return true;
  return roundPct(marginPct) < roundPct(floorPct);
}

function axisMax(marginPct: number, floorPct: number): number {
  const largest = Math.max(Number.isFinite(marginPct) ? marginPct : 0, floorPct);
  const needed = Math.ceil((largest * AXIS_HEADROOM) / AXIS_STEP) * AXIS_STEP;
  return clamp(needed, CANVAS_AXIS_MAX, 100);
}

/** Position on the 0-`max` axis as a percentage of the track, clamped to it. */
function axisPosition(value: number, max: number): number {
  return clamp((value / max) * 100, 0, 100);
}

/**
 * The percent as the label prints it. `<0` stands in for the degenerate
 * -Infinity margin: there is no catalog key for "not computable" and printing
 * "-Infinity %" would be worse than a truthful inequality. Any finite value —
 * including a genuinely negative margin, which happens whenever cost exceeds
 * price — prints as its rounded self.
 */
function displayPct(pct: number): string {
  return Number.isFinite(pct) ? String(roundPct(pct)) : "<0";
}

export function MarginFloorMeter({
  marginPct,
  floorPct,
  className,
}: {
  /** The real ADR 0059 margin as a percent 0-100 (from `lib/margin`). */
  marginPct: number;
  /** The org's margin floor as a percent 0-100. */
  floorPct: number;
  className?: string;
}) {
  const t = useTranslations("configurator");
  const floorId = useId();

  const breach = marginBreaches(marginPct, floorPct);
  const max = axisMax(marginPct, floorPct);
  const fill = axisPosition(marginPct, max);
  const tick = axisPosition(floorPct, max);
  const valueText = t("marginWithPct", { pct: displayPct(marginPct) });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui-sm font-semibold">{valueText}</span>
        <span id={floorId} className="text-muted-foreground text-ui-xs">
          {t("marginFloor", { pct: displayPct(floorPct) })}
        </span>
      </div>

      {/*
        A real `meter` (a static gauge inside a known range), not a decorative
        div. `aria-valuenow` is clamped into [0, max] because ARIA requires it to
        sit inside the declared range, while `aria-valuetext` carries the TRUE
        reading — that is what a negative or non-computable margin is announced
        as. `aria-describedby` points at the visible floor text, so the limit is
        part of the gauge's announcement without inventing a second string.
        Breach is never carried by colour alone: `CommercialPanel` raises a
        `warning` Alert (role="alert") alongside it.
      */}
      <div
        role="meter"
        aria-label={t("margin")}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamp(roundPct(marginPct), 0, max)}
        aria-valuetext={valueText}
        aria-describedby={floorId}
        data-breach={breach ? "true" : undefined}
        className="relative"
      >
        <div className="bg-chrome-subtle h-2 overflow-hidden rounded-full">
          <div
            data-slot="margin-floor-fill"
            className={cn("h-full rounded-full", breach ? "bg-destructive" : "bg-success")}
            style={{ width: `${fill}%` }}
          />
        </div>
        {/* The floor tick rides ABOVE the track in its own layer so the track's
            overflow clip cannot swallow it at the extremes of the axis. */}
        <span
          aria-hidden={true}
          data-slot="margin-floor-tick"
          className="bg-foreground/60 absolute inset-y-0 w-0.5 -translate-x-px rounded-full"
          style={{ left: `${tick}%` }}
        />
      </div>
    </div>
  );
}
