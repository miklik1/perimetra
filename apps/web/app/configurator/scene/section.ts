"use client";

/**
 * The section / cutaway slice (ADR 0092) — the viewport "řez / section" control.
 * Like the finish/deviation/explode slices, this is presentation state only: a
 * clipping plane cuts the rendered pieces (revealing the hollow profiles); it
 * never touches the engine, BOM, or price.
 *
 * `axis` chooses the cut direction, `position` (0..1) slides the cut across the
 * scene AABB. The plane itself is mutated imperatively in `scene-canvas`
 * (`SectionPlaneRig`) off this state, so scrubbing never re-renders the walker.
 */
import { create } from "zustand";

import { nextAxis, type SectionAxis } from "./section-plane";

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

interface SectionState {
  enabled: boolean;
  axis: SectionAxis;
  /** Cut position along the axis, 0 (AABB min) → 1 (AABB max). */
  position: number;
  toggle: () => void;
  cycleAxis: () => void;
  setPosition: (position: number) => void;
}

export const useSection = create<SectionState>((set) => ({
  enabled: false,
  // Default to cutting across width (X) — slices the posts/infill to show their
  // tube cross-sections; the user can cycle to Y/Z.
  axis: "x",
  position: 0.5,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  cycleAxis: () => set((s) => ({ axis: nextAxis(s.axis) })),
  setPosition: (position) => set({ position: clamp01(position) }),
}));
