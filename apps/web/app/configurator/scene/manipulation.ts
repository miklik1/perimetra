"use client";

/**
 * The direct-manipulation slice (ADR 0116 immersive frame, CORE_SPEC §7.6) — the
 * viewport interaction state the immersive editor reads and its controls write.
 * A SEPARATE concern from finish/deviation/explode/section, following the same
 * pattern: presentation + interaction state, read imperatively inside the Canvas
 * rigs (a module-singleton store crosses the R3F reconciler boundary the way
 * `useExplode`/`useSection` already do — React context would not without a
 * bridge), never engine data.
 *
 * Three things live here:
 *
 *   1. LAYOUT MODE — `immersive` swaps the whole configurator between the banded
 *      form layout and the edge-to-edge scene editor. It lives in the store, not
 *      as `ConfiguratorInner` React state, because both the app-land layout AND
 *      the in-scene fullscreen toggle must reach it.
 *   2. TOOL + SELECTION — the active dock tool (`select` picks parts, `dim`
 *      suppresses picking so pills/handles can be worked without selecting), and
 *      the part path a pick selected.
 *   3. THE APP-LAND BRIDGE — the width/height parameter bindings, the current
 *      values, and the two write paths (`commit` = one wizard `setValue` on
 *      pointer-up; `preview` = an rAF-cadence worker derive during the drag,
 *      §7.6). `ConfiguratorInner` owns that data and syncs it in each render; the
 *      Canvas rigs and the DOM handle/pill handlers read it. `pxPerMm` is written
 *      by the in-Canvas projector each frame so the DOM drag handler can convert a
 *      screen-space delta into millimetres.
 *
 * The store is a singleton, so `reset()` clears it on `ConfiguratorInner` mount
 * (a fresh session starts banded, unselected) and `setSelected(null)` clears the
 * stale selection when the scene remounts on a product switch.
 */
import { create } from "zustand";

import type { DimensionRole, ResolvedUiStep } from "@repo/model";

/** The active dock tool. `select` and `dim` are the two manipulation modes this
 *  store owns; `section`/`explode` are independent overlay toggles (their own
 *  stores) and `measure`/`rotate` are deferred (ADR 0116), so the store never
 *  holds them — the dock renders those from `useSection`/`useExplode` and as
 *  disabled affordances respectively. */
type ManipulationTool = "select" | "dim";

/**
 * One editable dimension the pills and corner handles address. `key` is the
 * release parameter (§7.6: a pill that cannot address a form-exposed parameter
 * is not shown), and `min`/`max` are its `range` domain bounds — the drag clamps
 * to them (a value that is in-domain but violates a constraint is a *valid* drag
 * target that surfaces a defect, so the clamp is the domain, not the constraint).
 */
export interface DimensionBinding {
  key: string;
  label: string;
  /** The current millimetre value (effective scope value, else raw input). */
  value: number;
  min: number;
  max: number;
  /** Increment for keyboard/stepper nudges; the domain `step` or a sane default. */
  step: number;
}

/**
 * The data + write paths `ConfiguratorInner` lends the manipulation layer. Held
 * as one object and replaced wholesale each sync, so a rig reads a consistent
 * snapshot rather than fields that were set in different renders.
 */
export interface ManipulationBridge {
  /** The width dimension (top pill + corner-handle horizontal drag), or null when
   *  the release authors no addressable range parameter for it. */
  width: DimensionBinding | null;
  /** The height dimension (right pill), or null. */
  height: DimensionBinding | null;
  /** Persist a value to the wizard input — exactly one `setValue`, fired on
   *  pointer-up / pill submit so the optimistic-lock version bumps once per
   *  gesture, not once per frame (§7.6). */
  commit: (key: string, value: number) => void;
  /** Fire an immediate worker derive for `{...input, [key]: value}`, bypassing the
   *  150 ms keystroke debounce — the drag's rAF-throttled cadence (§7.6). The
   *  derivation it produces updates the live scene, price and defects; nothing is
   *  persisted until `commit`. */
  preview: (key: string, value: number) => void;
}

/** An in-flight drag: which dimension, and its live optimistic value in mm. */
interface DragState {
  key: string;
  value: number;
}

interface ManipulationState {
  immersive: boolean;
  setImmersive: (immersive: boolean) => void;
  toggleImmersive: () => void;

  tool: ManipulationTool;
  setTool: (tool: ManipulationTool) => void;

  /** The selected part path (`<instanceId>/<partPath>/<pieceId>` trimmed to the
   *  part, i.e. `<instanceId>/<partPath>`), or null. Cleared on scene remount. */
  selected: string | null;
  setSelected: (selected: string | null) => void;

  /** The live drag, or null when idle. Read by the pill so it shows the dragged
   *  value while a handle moves. Reactive on purpose: zustand isolates selector
   *  slices, so a per-frame write here re-renders ONLY the pill that selects it,
   *  never the dock or the overlay root. (Pixels-per-mm, by contrast, is written
   *  every frame and is NOT store state — it lives in the imperative overlay ref
   *  so the projection never re-renders anything.) */
  drag: DragState | null;
  setDrag: (drag: DragState | null) => void;

  bridge: ManipulationBridge | null;
  setBridge: (bridge: ManipulationBridge | null) => void;

  reset: () => void;
}

const INITIAL = {
  immersive: false,
  tool: "select" as ManipulationTool,
  selected: null,
  drag: null,
} satisfies Partial<ManipulationState>;

export const useManipulation = create<ManipulationState>((set) => ({
  ...INITIAL,
  bridge: null,
  // Leaving immersive clears the selection AND any live drag: the selection glow
  // (scene-renderer) and the pills/handles only exist inside the immersive
  // editor, and the banded 3D view has no affordance to dismiss a stale glow —
  // so a picked part must not survive the exit (ADR 0116).
  setImmersive: (immersive) =>
    set(immersive ? { immersive } : { immersive, selected: null, drag: null }),
  toggleImmersive: () =>
    set((s) =>
      s.immersive ? { immersive: false, selected: null, drag: null } : { immersive: true },
    ),
  setTool: (tool) => set({ tool }),
  setSelected: (selected) => set({ selected }),
  setDrag: (drag) => set({ drag }),
  setBridge: (bridge) => set({ bridge }),
  // Keeps `bridge` — it is re-synced every render by the owner, and clearing it
  // here would blank the layer for a frame on remount. Layout/tool/selection are
  // the per-session state that must start clean.
  reset: () => set({ ...INITIAL }),
}));

/** One candidate dimension parameter: its key, label and `range` domain bounds,
 *  already narrowed to the numeric-min-and-max case a drag can clamp against. */
export interface DimensionRange {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/**
 * Which parameters the §7.6 pills and corner handles address, resolved off the
 * RESOLVED UI (so a parameter hidden by its `relevance` is never draggable).
 *
 * Since ADR 0136 the release names them: a parameter tagged
 * `dimensionRole: "width"` / `"height"` IS that dimension, wherever it is
 * declared. The ADR 0117 §3 positional heuristic — the first two visible bounded
 * `range` parameters, by declaration order — survives only as the fallback for a
 * release that authors NO role at all, which is every release published before
 * ADR 0136, including immutable ones that can never be re-authored. That fallback
 * must therefore not be deleted.
 *
 * The fallback is whole-release, not per-dimension, on purpose: a vendor who tags
 * only the width gets a width pill and NO height pill (§7.6 — a control that
 * cannot address a form-exposed parameter is not shown) rather than a height
 * silently back-filled from a parameter they did not nominate.
 *
 * Only bounded parameters are candidates either way: without a numeric min AND
 * max the drag has no rail to clamp to (the gate refuses an authored role on such
 * a parameter, but a pre-ADR-0136 release reaches the positional path unchecked).
 */
export function resolveDimensionRanges(steps: ResolvedUiStep[]): {
  width?: DimensionRange | undefined;
  height?: DimensionRange | undefined;
} {
  const candidates: { range: DimensionRange; role: DimensionRole | undefined }[] = [];
  for (const group of steps.flatMap((s) => s.groups)) {
    for (const { def, visible } of group.params) {
      if (!visible || def.domain?.kind !== "range") continue;
      const { min, max, step } = def.domain;
      if (typeof min !== "number" || typeof max !== "number") continue;
      candidates.push({
        range: { key: def.key, label: def.label ?? def.key, min, max, step: step ?? 10 },
        role: def.dimensionRole,
      });
    }
  }
  const width = candidates.find((c) => c.role === "width")?.range;
  const height = candidates.find((c) => c.role === "height")?.range;
  if (width !== undefined || height !== undefined) return { width, height };
  return { width: candidates[0]?.range, height: candidates[1]?.range };
}

/**
 * The width/height dimension bindings for a release. The pair is chosen by the
 * CALLER — since ADR 0136 a release names its own spatial dimensions through
 * `ParameterDef.dimensionRole`, and `ConfiguratorInner` resolves the role before
 * calling here (falling back to the ADR 0117 §3 positional heuristic only for a
 * release that authors no role at all, which is every release published before
 * that ADR — including immutable ones that can never be re-authored). This
 * function is therefore pure binding: pick a value, or yield null.
 *
 * A dimension with no parameter is null, and its pill/handle is then not shown
 * (§7.6 — a control that cannot address a form-exposed parameter is not shown).
 *
 * Effective scope values are preferred over raw input so a defaulted parameter
 * still reads a value; the drag/pill always writes the raw parameter key.
 */
export function dimensionBindings(
  ranges: { width?: DimensionRange | undefined; height?: DimensionRange | undefined },
  read: (key: string) => number | null,
): { width: DimensionBinding | null; height: DimensionBinding | null } {
  const bind = (r: DimensionRange | undefined): DimensionBinding | null => {
    if (r === undefined) return null;
    const value = read(r.key);
    if (value === null) return null;
    return { key: r.key, label: r.label, value, min: r.min, max: r.max, step: r.step };
  };
  return { width: bind(ranges.width), height: bind(ranges.height) };
}

/** Clamp a dimension value to its `range` domain — the drag rail (§7.6). */
export function clampToBinding(binding: DimensionBinding, value: number): number {
  return value < binding.min ? binding.min : value > binding.max ? binding.max : value;
}

/**
 * The selection key of a scene piece: its id (`<instanceId>/<partPath>/<pieceId>`)
 * with the trailing piece segment removed, i.e. the part it belongs to. Picking
 * and the scene highlight both key by this, so a picked piece and its siblings
 * always resolve to the same part — the function is the single source of that
 * grouping, so even where a nested part path makes the strip imperfect, the pick
 * and the highlight agree.
 */
export function selectionKeyOf(pieceId: string): string {
  const cut = pieceId.lastIndexOf("/");
  return cut === -1 ? pieceId : pieceId.slice(0, cut);
}
