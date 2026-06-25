"use client";

/**
 * The deviation-highlight slice (ADR 0076) — the viewport "highlight deviations"
 * toggle (CORE_SPEC §6). OFF (default): pieces wear their finish, a deviated
 * piece is amber. ON: deviated pieces go emissive amber while the rest desaturate
 * to a muted grey, so a deviated element pops out of a busy gate.
 *
 * This is a SEPARATE concern from the always-on out-of-frustum edge markers
 * (`scene-canvas.tsx`) — those guarantee "no angle hides a deviated piece"
 * regardless of this toggle; the toggle is an emphasis aid, not the guarantee.
 */
import { create } from "zustand";

interface DeviationState {
  highlight: boolean;
  setHighlight: (highlight: boolean) => void;
  toggle: () => void;
}

export const useDeviation = create<DeviationState>((set) => ({
  highlight: false,
  setHighlight: (highlight) => set({ highlight }),
  toggle: () => set((s) => ({ highlight: !s.highlight })),
}));
