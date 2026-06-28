"use client";

/**
 * The exploded-view slice (ADR 0091) — the viewport "rozložit / explode" control.
 * A SEPARATE concern from finish (`finish.ts`) and deviation (`deviation.ts`),
 * following the same pattern: presentation state the renderer reads and a viewport
 * control writes, never engine data.
 *
 * Two values because the explode ANIMATES: `target` is the discrete intent the
 * toggle/slider writes (0 = assembled, 1 = fully exploded), `factor` is the live
 * value `ExplodeAnimator` (`scene-canvas.tsx`) damps toward it each frame. The
 * renderer positions pieces by `factor`; the camera switches to the iso pose off
 * `target` (a stable boolean, so the pose never recomputes mid-animation).
 */
import { create } from "zustand";

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

interface ExplodeState {
  /** The live, animated 0→1 explode amount the renderer reads. */
  factor: number;
  /** The discrete target the toggle/slider sets; `factor` chases it. */
  target: number;
  setTarget: (target: number) => void;
  setFactor: (factor: number) => void;
  toggle: () => void;
}

export const useExplode = create<ExplodeState>((set) => ({
  factor: 0,
  target: 0,
  setTarget: (target) => set({ target: clamp01(target) }),
  setFactor: (factor) => set({ factor }),
  toggle: () => set((s) => ({ target: s.target > 0 ? 0 : 1 })),
}));
