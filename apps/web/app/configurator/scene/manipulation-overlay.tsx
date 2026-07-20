"use client";

import * as React from "react";

import { useLocale, useTranslations } from "@repo/i18n/web";
import type { Scene3D } from "@repo/renderers";
import { IconButton } from "@repo/ui";

import {
  clampToBinding,
  selectionKeyOf,
  useManipulation,
  type DimensionBinding,
} from "./manipulation";
import { CORNER_SIGN, type OverlayRefs } from "./manipulation-rig";

/**
 * The immersive editor's DOM overlay (ADR 0116, CORE_SPEC §7.6): the corner
 * resize handles, the editable dimension pills, and the selection identity chip.
 * Rendered as a `pointer-events-none` layer over the canvas; only the affordances
 * take pointer events. Positions come from `<ManipulationProjector>` (it writes
 * each element's transform by ref every frame) — this component never computes a
 * screen position, it only registers its elements and owns the interaction.
 *
 * The width handles and pill address the release's width parameter; the height
 * pill addresses the height parameter (§7.6: a pill that cannot address a
 * form-exposed parameter is not shown, so a null binding renders nothing). Both
 * write the SAME parameter the form field writes — one parameter, two editors.
 */
export function ManipulationOverlay({
  refs,
  scene,
}: {
  refs: OverlayRefs;
  scene: Scene3D;
}): React.JSX.Element {
  const bridge = useManipulation((s) => s.bridge);
  const parts = React.useMemo(() => partIndex(scene), [scene]);

  // Stable ref-setters: the bridge re-syncs on every derive, so this overlay
  // re-renders per frame during a drag. Inline ref arrows would detach and
  // reattach each handle every render; keyed to the stable `refs` object, these
  // never change identity, so the projector's targets stay put.
  const registerCorner = React.useMemo(
    () =>
      [0, 1, 2, 3].map((i) => (el: HTMLButtonElement | null) => {
        refs.corners[i] = el;
      }),
    [refs],
  );
  const registerWidthPill = React.useCallback(
    (el: HTMLElement | null) => {
      refs.widthPill = el;
    },
    [refs],
  );
  const registerHeightPill = React.useCallback(
    (el: HTMLElement | null) => {
      refs.heightPill = el;
    },
    [refs],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {bridge?.width != null && (
        <>
          {CORNER_SIGN.map((sign, index) => (
            <CornerHandle
              key={index}
              sign={sign}
              binding={bridge.width!}
              refs={refs}
              register={registerCorner[index]!}
            />
          ))}
          <DimensionPill binding={bridge.width} register={registerWidthPill} />
        </>
      )}
      {bridge?.height != null && (
        <DimensionPill binding={bridge.height} register={registerHeightPill} />
      )}
      <SelectionChip parts={parts} />
    </div>
  );
}

/**
 * A corner resize handle. Dragging horizontally rewrites the width parameter:
 * `left` corners widen on a leftward pull, `right` corners on a rightward pull
 * (`sign`). The derive is emitted at most once per animation frame (§7.6 rAF
 * throttle) against a synthetic input (`preview`); the scene, price and defects
 * track it live. Exactly one `commit` fires on pointer-up, so the optimistic-lock
 * version bumps once per gesture. The value clamps to the `range` domain — the
 * handle stops at the rail, and an in-domain value that violates a constraint is
 * a valid drag target that surfaces its defect live.
 *
 * Keyboard-operable as a real control (§12.1): Arrow keys nudge by the domain
 * step and commit immediately.
 */
function CornerHandle({
  sign,
  binding,
  refs,
  register,
}: {
  sign: number;
  binding: DimensionBinding;
  refs: OverlayRefs;
  register: (el: HTMLButtonElement | null) => void;
}): React.JSX.Element {
  const t = useTranslations("configurator");
  // The live gesture, in a ref so a pointermove never re-renders this button.
  const gesture = React.useRef<{
    startX: number;
    startValue: number;
    latestX: number;
    raf: number | null;
  } | null>(null);

  // The keyboard nudge is its own micro-drag: OS key-repeat accumulates in this
  // ref (NOT off binding.value, which lags the debounced derive — reading it per
  // repeat would recompute the same frozen value and stall the scene until key
  // release). It previews live like a drag and commits once on key-up.
  const keyValue = React.useRef<number | null>(null);

  // Cancel a pending drag frame if this handle unmounts mid-gesture.
  React.useEffect(
    () => () => {
      if (gesture.current?.raf != null) cancelAnimationFrame(gesture.current.raf);
    },
    [],
  );

  const tick = React.useCallback(() => {
    const g = gesture.current;
    if (g === null) return;
    g.raf = null;
    const pxPerMm = refs.pxPerMm;
    if (pxPerMm <= 0) return;
    const next = clampToBinding(binding, g.startValue + (sign * (g.latestX - g.startX)) / pxPerMm);
    const state = useManipulation.getState();
    state.setDrag({ key: binding.key, value: next });
    state.bridge?.preview(binding.key, next);
  }, [binding, sign, refs]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      startX: e.clientX,
      startValue: binding.value,
      latestX: e.clientX,
      raf: null,
    };
    useManipulation.getState().setDrag({ key: binding.key, value: binding.value });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (g === null) return;
    g.latestX = e.clientX;
    if (g.raf === null) g.raf = requestAnimationFrame(tick);
  };

  const endGesture = () => {
    const g = gesture.current;
    if (g === null) return;
    if (g.raf !== null) cancelAnimationFrame(g.raf);
    gesture.current = null;
    const state = useManipulation.getState();
    // The clamped value the last frame settled on lives in `drag`; commit it once.
    const final = state.drag?.value ?? binding.value;
    state.setDrag(null);
    state.bridge?.commit(binding.key, final);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const base = keyValue.current ?? binding.value;
    const next = clampToBinding(binding, base + dir * binding.step);
    keyValue.current = next;
    const state = useManipulation.getState();
    state.setDrag({ key: binding.key, value: next });
    state.bridge?.preview(binding.key, next);
  };

  // Commit the accumulated keyboard nudge once, on key-up (or if focus leaves
  // mid-hold). A no-op when no nudge is pending.
  const commitKey = () => {
    const final = keyValue.current;
    if (final === null) return;
    keyValue.current = null;
    const state = useManipulation.getState();
    state.setDrag(null);
    state.bridge?.commit(binding.key, final);
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") commitKey();
  };

  return (
    <button
      type="button"
      ref={register}
      aria-label={t("resizeHandle", { dimension: binding.label })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={commitKey}
      className="border-ring bg-chrome shadow-soft-sm focus-visible:ring-ring pointer-coarse:size-6 pointer-events-auto absolute left-0 top-0 size-4 cursor-ew-resize touch-none rounded-[3px] border-2 outline-none focus-visible:ring-2"
    />
  );
}

/**
 * An editable dimension pill. It shows the parameter's label, value and unit and,
 * on click/Enter, becomes a numeric input that clamps and commits the SAME
 * parameter the form field owns. While a handle is dragging this dimension, the
 * pill reflects the live dragged value instead of the committed one.
 */
function DimensionPill({
  binding,
  register,
}: {
  binding: DimensionBinding;
  register: (el: HTMLElement | null) => void;
}): React.JSX.Element {
  const t = useTranslations("configurator");
  const locale = useLocale();
  const [editing, setEditing] = React.useState(false);
  const drag = useManipulation((s) => s.drag);
  const dragging = drag?.key === binding.key;
  const shown = dragging ? drag.value : binding.value;

  // Focus the editor when it opens (the user just clicked the pill to edit) via
  // an effect rather than `autoFocus`, which the a11y rule bans for the
  // page-load case this is not. On a KEYBOARD close (Enter/Escape) the input
  // unmounts, so restore focus to the trigger — otherwise focus falls to <body>
  // and the next Tab restarts at the top. NOT on blur-to-elsewhere, which must
  // keep the focus the user moved it to.
  const inputRef = React.useRef<HTMLInputElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const restoreFocus = React.useRef(false);
  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(/\s/g, "").replace(",", "."));
    setEditing(false);
    if (!Number.isFinite(parsed)) return;
    useManipulation.getState().bridge?.commit(binding.key, clampToBinding(binding, parsed));
  };

  return (
    <div ref={register} className="pointer-events-auto absolute left-0 top-0 flex items-center">
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          defaultValue={String(Math.round(shown))}
          aria-label={binding.label}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              restoreFocus.current = true;
              commit((e.target as HTMLInputElement).value);
            }
            if (e.key === "Escape") {
              restoreFocus.current = true;
              setEditing(false);
            }
          }}
          className="border-ring bg-chrome text-foreground font-data ring-ring/25 w-24 rounded-[var(--radius-inset)] border-[1.5px] px-2 py-1 text-[12.5px] font-semibold tabular-nums shadow-[0_0_0_3px] outline-none"
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setEditing(true)}
          aria-label={t("editDimension", { dimension: binding.label })}
          data-active={dragging || undefined}
          className="border-input bg-chrome text-foreground shadow-soft-sm hover:border-ring focus-visible:ring-ring data-[active]:border-ring font-data flex items-center gap-1.5 rounded-[var(--radius-inset)] border-[1.5px] px-2.5 py-1 text-[12.5px] font-semibold tabular-nums outline-none focus-visible:ring-2"
        >
          {new Intl.NumberFormat(locale).format(Math.round(shown))}
          <span className="text-muted-foreground font-normal">{t("unitMm")}</span>
        </button>
      )}
    </div>
  );
}

/**
 * The selection identity chip. Picking a part in `select` mode highlights it in
 * the scene (`scene-renderer`) and names it here. This is deliberately identity
 * only — NOT the design frame's part toolbar with a parameter stepper: the
 * release authors no binding from a rendered part to a parameter, and §7.6 / §5
 * forbid fabricating one. Recorded as a deviation (ADR 0116). A fixed chip rather
 * than a scene-anchored toolbar, because the emissive highlight is the spatial
 * anchor and the chip only carries the name and the clear action.
 */
function SelectionChip({
  parts,
}: {
  parts: Map<string, { name: string; componentCode: string }>;
}): React.JSX.Element | null {
  const t = useTranslations("configurator");
  const selected = useManipulation((s) => s.selected);
  const setSelected = useManipulation((s) => s.setSelected);
  if (selected === null) return null;
  const part = parts.get(selected);
  if (part === undefined) return null;
  return (
    <div className="bg-chrome shadow-float pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2.5 rounded-[var(--radius-control)] py-1.5 pl-3.5 pr-1.5">
      <span className="text-foreground text-ui-sm font-semibold">{part.name}</span>
      <span className="text-muted-foreground font-data text-ui-xs">{part.componentCode}</span>
      <IconButton
        size="sm"
        aria-label={t("clearSelection")}
        onClick={() => setSelected(null)}
        className="pointer-coarse:size-11"
      >
        <CloseGlyph />
      </IconButton>
    </div>
  );
}

/** A plain × (no icon-lib dependency, matching the scene's other inline glyphs). */
function CloseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Selection-key → part identity, for the chip. Keyed by {@link selectionKeyOf}
 * so a picked piece and its highlighted siblings resolve to the same entry.
 */
function partIndex(scene: Scene3D): Map<string, { name: string; componentCode: string }> {
  const index = new Map<string, { name: string; componentCode: string }>();
  for (const instance of scene.instances) {
    for (const piece of instance.pieces) {
      const key = selectionKeyOf(piece.id);
      if (!index.has(key)) index.set(key, { name: piece.name, componentCode: piece.componentCode });
    }
  }
  return index;
}
