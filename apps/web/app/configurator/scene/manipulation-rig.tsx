"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import { Vector3 } from "three";

import type { SceneFrame } from "./frame";

/**
 * The imperative bridge between the in-`Canvas` projector and the DOM overlay
 * (ADR 0116, CORE_SPEC §7.6). SceneCanvas owns one of these; it passes the same
 * object to `<ManipulationProjector>` (which WRITES element transforms + `pxPerMm`
 * each frame) and to `<ManipulationOverlay>` (which registers its elements here
 * by ref and READS `pxPerMm` in its drag handler). Nothing here is React state,
 * so the per-frame projection re-renders nothing — the `DeviationProjector`
 * pattern, extended to interactive affordances.
 */
export interface OverlayRefs {
  /** Corner handles, order [TL, TR, BL, BR]; each is horizontal-drag → width. */
  corners: (HTMLButtonElement | null)[];
  /** The top-centre width pill and the right-centre height pill. */
  widthPill: HTMLElement | null;
  heightPill: HTMLElement | null;
  /** Screen pixels per world millimetre at the gate plane, refreshed each frame;
   *  the drag handler divides a pixel delta by it to get millimetres. */
  pxPerMm: number;
}

export function makeOverlayRefs(): OverlayRefs {
  return { corners: [null, null, null, null], widthPill: null, heightPill: null, pxPerMm: 0 };
}

/** Which side each corner pulls: left corners widen on leftward drag (−1), right
 *  corners on rightward drag (+1). Order matches {@link OverlayRefs.corners}. */
export const CORNER_SIGN = [-1, 1, -1, 1] as const;

const NDC_BEHIND = 1;

/**
 * Projects the gate's world AABB (the SOLID box `frame.min`/`frame.max`, the same
 * one the section cut uses) to screen pixels each frame and drives the overlay
 * elements by ref. The four front-face corners become the resize handles; the
 * top-centre and right-centre anchors carry the width/height pills. `pxPerMm` is
 * measured by projecting two points 1000 mm apart across the gate centre.
 *
 * Rendered only in immersive mode, and only when the scene has geometry, so a
 * missing element (a pill the release does not bind) is simply skipped.
 */
export function ManipulationProjector({
  frame,
  refs,
}: {
  frame: SceneFrame;
  refs: OverlayRefs;
}): null {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new Vector3(), []);
  const v2 = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const [minX, minY, minZ] = frame.min;
    const [maxX, maxY, maxZ] = frame.max;
    const frontZ = Math.max(minZ, maxZ); // the face toward the viewer (+Z)
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const place = (el: HTMLElement | null | undefined, x: number, y: number, z: number): void => {
      if (el == null) return;
      v.set(x, y, z).project(camera);
      if (v.z > NDC_BEHIND) {
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      const px = (v.x * 0.5 + 0.5) * size.width;
      const py = (v.y * -0.5 + 0.5) * size.height;
      el.style.transform = `translate(-50%, -50%) translate(${px}px, ${py}px)`;
    };

    // Four front-face corners → resize handles.
    place(refs.corners[0], minX, maxY, frontZ);
    place(refs.corners[1], maxX, maxY, frontZ);
    place(refs.corners[2], minX, minY, frontZ);
    place(refs.corners[3], maxX, minY, frontZ);

    // Dimension pill anchors, nudged just outside the gate so they clear it.
    const pad = frame.radius * 0.06;
    place(refs.widthPill, cx, maxY + pad, frontZ);
    place(refs.heightPill, maxX + pad, cy, frontZ);

    // Pixels-per-mm across the gate centre (horizontal): project two points
    // 1000 mm apart and measure the screen span. Guarded so a degenerate camera
    // never yields a zero the drag handler would divide by.
    v.set(cx, cy, frontZ).project(camera);
    v2.set(cx + 1000, cy, frontZ).project(camera);
    const span = Math.abs(v2.x - v.x) * 0.5 * size.width; // NDC→px over 1000 mm
    if (span > 1e-4) refs.pxPerMm = span / 1000;
  });

  return null;
}
