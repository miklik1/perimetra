"use client";

import {
  CameraControls,
  ContactShadows,
  Environment,
  Lightformer,
  type CameraControlsImpl,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  ACESFilmicToneMapping,
  MathUtils,
  Plane,
  SRGBColorSpace,
  Vector3,
  type Vector3Tuple,
} from "three";

import { useTranslations } from "@repo/i18n/web";
import type { Scene3D, Vec3 } from "@repo/renderers";
import { Badge, IconButton, IconCluster } from "@repo/ui";

import { cameraPose, type CameraView } from "./camera-poses";
import { useDeviation } from "./deviation";
import { deviatedPieceCenters, placeEdgeMarker } from "./deviation-markers";
import { useExplode } from "./explode";
import { pieceExplodeOffsets } from "./explode-offsets";
import { frameScene, type SceneFrame } from "./frame";
import { SceneRenderer } from "./scene-renderer";
import { useSection } from "./section";
import { sectionPlane } from "./section-plane";

/** Stable empty clip set — a no-section scene passes this so the memo'd walker
 *  never re-renders for the toggle's "off" state. */
const NO_PLANES: Plane[] = [];

/** Damping rate for the assemble↔explode transition — perceptually settled in
 *  ~0.5 s, fully snapped by ~0.9 s (ADR 0091; the exact feel is render-taste). */
const EXPLODE_LAMBDA = 6;

/**
 * The configurator's studio canvas (ADR 0073/0074/0075/0076). World units are mm
 * (hence the far plane); the parent remounts this per release (`key=`), so the
 * initial camera pose just fits the first derivation and OrbitControls owns it
 * after.
 *
 * Studio lighting (ADR 0074): a procedural drei `<Environment>` of `<Lightformer>`s
 * gives invisible image-based PBR fill (CSP-clean, no external HDR) + a key
 * `directionalLight` + `<ContactShadows>` grounding on `frame.groundY`.
 *
 * Camera choreography (ADR 0077, technique 6): one persistent `<CameraControls>`
 * (OrbitControls dropped) — a named pose per wizard step (`view`) the rig
 * animates to with `smoothTime` + `setLookAt(…, true)`, interruptible by the user.
 *
 * Deviation surfacing (ADR 0076, CORE_SPEC §6): every deviated piece gets a
 * ref-driven DOM **edge marker** that rides the viewport edge when the piece
 * leaves the frustum (the per-frame `vec3.project(camera)` lives in
 * `DeviationProjector`; the pure clamp math + world centres in
 * `deviation-markers.ts`) — so NO camera angle can hide a deviated piece. The
 * highlight toggle drives the emissive/desaturate emphasis (`scene-renderer`).
 */
export default function SceneCanvas({
  scene,
  view = "hero",
}: {
  scene: Scene3D;
  view?: CameraView;
}) {
  const t = useTranslations("configurator");
  const frame = useMemo(() => frameScene(scene), [scene]);
  // Exploded view (ADR 0091): the per-piece bloom + the deviated-piece centres at
  // both ends (assembled and fully bloomed) so the §6 markers lerp through the
  // explode without drift.
  const offsets = useMemo(() => pieceExplodeOffsets(scene), [scene]);
  const deviatedCenters = useMemo(() => deviatedPieceCenters(scene), [scene]);
  const deviatedBloomed = useMemo(() => deviatedPieceCenters(scene, offsets), [scene, offsets]);
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const highlight = useDeviation((s) => s.highlight);
  const toggleHighlight = useDeviation((s) => s.toggle);
  const explodeTarget = useExplode((s) => s.target);
  const toggleExplode = useExplode((s) => s.toggle);
  const setExplodeTarget = useExplode((s) => s.setTarget);

  // Section (ADR 0092): a single stable Plane the SectionPlaneRig mutates each
  // frame; the clip set passed to the (memo'd) walker switches ref only on the
  // on/off toggle, so axis/position scrubs never reconcile the piece tree.
  const sectionEnabled = useSection((s) => s.enabled);
  const sectionAxis = useSection((s) => s.axis);
  const sectionPosition = useSection((s) => s.position);
  const toggleSection = useSection((s) => s.toggle);
  const cycleSectionAxis = useSection((s) => s.cycleAxis);
  const setSectionPosition = useSection((s) => s.setPosition);
  const sectionPlaneRef = useRef(new Plane(new Vector3(0, 0, -1), 0));
  const clippingPlanes = useMemo(
    () => (sectionEnabled ? [sectionPlaneRef.current] : NO_PLANES),
    [sectionEnabled],
  );

  const keyLight: Vector3Tuple = [
    frame.center[0] + frame.radius,
    frame.center[1] + frame.radius * 1.6,
    frame.center[2] + frame.radius,
  ];

  // Explode overrides the step pose with the pulled-back iso reveal; keyed off the
  // discrete `target` (not the animating `factor`) so the pose never recomputes
  // mid-transition — the camera animates once, then the user can orbit freely.
  const effectiveView: CameraView = explodeTarget > 0 ? "exploded" : view;
  const pose = useMemo(() => cameraPose(effectiveView, frame), [effectiveView, frame]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          outputColorSpace: SRGBColorSpace,
          // Per-material section clipping (ADR 0092) — pieces only; the studio
          // shadow/IBL stay whole.
          localClippingEnabled: true,
        }}
        camera={{ fov: 45, near: 10, far: 120000, position: pose.position }}
        dpr={[1, 2]}
      >
        {/* The Bombardier warm-grey field (brand `--color-field`); IBL stays invisible above it. */}
        <color attach="background" args={["#ededed"]} />

        {/* Soft floor so shadowed faces never crush to black — the IBL carries the fill. */}
        <ambientLight intensity={0.3} />
        {/* One warm key for directional modelling + specular pop on the profile edges. */}
        <directionalLight position={keyLight} intensity={1.6} color="#fff6ec" />

        <SceneRenderer scene={scene} offsets={offsets} clippingPlanes={clippingPlanes} />

        {/* Soft contact shadow grounds the gate on the scene floor (hero mode, no grid). */}
        <ContactShadows
          position={[frame.center[0], frame.groundY, frame.center[2]]}
          scale={frame.radius * 2.6}
          resolution={1024}
          blur={2.6}
          opacity={0.5}
          far={frame.radius * 2.2}
          color="#0a0a0a"
        />

        {/* Procedural studio IBL — invisible (no background), no external HDR (CSP-clean). */}
        <Environment resolution={256} frames={1} background={false}>
          <Lightformer
            form="rect"
            intensity={3.2}
            color="#fff6ec"
            position={[2, 5, 6]}
            scale={[10, 10, 1]}
          />
          <Lightformer
            form="rect"
            intensity={1.1}
            color="#eef2f6"
            position={[-7, 2, 2]}
            scale={[6, 6, 1]}
          />
          <Lightformer
            form="rect"
            intensity={1.1}
            color="#eef2f6"
            position={[7, 1, -2]}
            scale={[6, 6, 1]}
          />
          <Lightformer
            form="rect"
            intensity={2.4}
            color="#ffffff"
            position={[0, 4, -8]}
            scale={[10, 5, 1]}
          />
          <Lightformer
            form="rect"
            intensity={0.5}
            color="#ededed"
            position={[0, -6, 0]}
            scale={[12, 12, 1]}
          />
        </Environment>

        {/* §6: per-frame projection of each deviated piece → its DOM edge marker
            (lerped through the live explode so the marker tracks the bloom). */}
        {deviatedCenters.length > 0 && (
          <DeviationProjector
            centers={deviatedCenters}
            bloomed={deviatedBloomed}
            markerRefs={markerRefs}
          />
        )}

        {/* Eases the explode factor toward its target each frame (ADR 0091). */}
        <ExplodeAnimator />

        {/* Mutates the section plane each frame off the live cut (ADR 0092). */}
        <SectionPlaneRig plane={sectionPlaneRef.current} frame={frame} />

        <CameraRig pose={pose} />
      </Canvas>

      {/* §6 edge markers — pointer-transparent overlay; the projector toggles each
          marker's visibility + position by ref (no per-frame React re-render). */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {deviatedCenters.map((_, i) => (
          <div
            key={i}
            ref={(el) => {
              markerRefs.current[i] = el;
            }}
            data-deviation-marker
            className="bg-deviation text-deviation-foreground shadow-soft absolute left-0 top-0 flex size-6 items-center justify-center rounded-full"
            style={{ display: "none" }}
            aria-hidden
          >
            <WarningGlyph />
          </div>
        ))}
      </div>

      {/* Viewport mode cluster (ADR 0091 explode + ADR 0092 section) — toggles
          plus their contextual scrub controls; an affordance like the deviation
          cluster on the right. */}
      <div className="absolute left-3 top-3 flex items-start gap-2">
        <IconCluster>
          <IconButton
            size="sm"
            active={explodeTarget > 0}
            onClick={toggleExplode}
            aria-pressed={explodeTarget > 0}
            aria-label={t("explode")}
            title={t("explode")}
          >
            <ExplodeGlyph />
          </IconButton>
          <IconButton
            size="sm"
            active={sectionEnabled}
            onClick={toggleSection}
            aria-pressed={sectionEnabled}
            aria-label={t("section")}
            title={t("section")}
          >
            <SectionGlyph />
          </IconButton>
        </IconCluster>
        <div className="flex flex-col gap-2">
          {explodeTarget > 0 && (
            // Floored at 5% so a scrub can never drive the target to 0 — full
            // collapse is the toggle's job, so the slider never unmounts itself
            // (and yanks the camera home) from under a drag.
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round(explodeTarget * 100)}
              onChange={(e) => setExplodeTarget(Number(e.target.value) / 100)}
              aria-label={t("explodeAmount")}
              className="accent-copper mt-0.5 h-1 w-28 cursor-pointer"
            />
          )}
          {sectionEnabled && (
            <div className="flex items-center gap-2">
              <IconButton
                size="sm"
                onClick={cycleSectionAxis}
                aria-label={t("sectionAxis")}
                title={t("sectionAxis")}
              >
                <span className="font-data text-[11px] font-semibold uppercase">{sectionAxis}</span>
              </IconButton>
              {/* Full 0..1 range — position is WHERE the cut sits, not whether
                  section is on (that's the toggle), so 0/1 are valid ends. */}
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(sectionPosition * 100)}
                onChange={(e) => setSectionPosition(Number(e.target.value) / 100)}
                aria-label={t("sectionPosition")}
                className="accent-copper h-1 w-28 cursor-pointer"
              />
            </div>
          )}
        </div>
      </div>

      {/* Count badge + highlight toggle — only when something deviates (§6 chrome). */}
      {deviatedCenters.length > 0 && (
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <Badge tone="deviation" aria-label={`${t("deviationsTitle")}: ${deviatedCenters.length}`}>
            {deviatedCenters.length}
          </Badge>
          <IconButton
            size="sm"
            active={highlight}
            onClick={toggleHighlight}
            aria-pressed={highlight}
            aria-label={t("deviationHighlight")}
            title={t("deviationHighlight")}
          >
            <WarningGlyph />
          </IconButton>
        </div>
      )}
    </div>
  );
}

/** The single camera controller (ADR 0077): animates to the step's named pose
 *  with `smoothTime` + `setLookAt(…, true)`, interruptible by user orbit. */
function CameraRig({ pose }: { pose: { position: Vec3; target: Vec3 } }) {
  const controls = useRef<CameraControlsImpl>(null);

  useEffect(() => {
    const c = controls.current;
    if (c === null) return;
    c.smoothTime = 0.55;
    void c.setLookAt(
      pose.position[0],
      pose.position[1],
      pose.position[2],
      pose.target[0],
      pose.target[1],
      pose.target[2],
      true,
    );
  }, [pose]);

  return <CameraControls ref={controls} makeDefault />;
}

/** A small warning triangle (no icon lib) — the deviation glyph. */
function WarningGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden>
      <path d="M12 3 2 20h20L12 3Z" strokeLinejoin="round" />
      <path d="M12 10v4" strokeLinecap="round" />
      <path d="M12 17h.01" strokeLinecap="round" />
    </svg>
  );
}

/** Inside the Canvas: project each deviated piece every frame and drive its DOM
 *  marker by ref (visibility + clamped edge position). No React state per frame.
 *  The projected centre is lerped between the assembled (`centers`) and fully
 *  bloomed (`bloomed`) positions by the live explode factor (linear, ADR 0091),
 *  so the §6 marker keeps pointing at the piece all the way through the explode. */
function DeviationProjector({
  centers,
  bloomed,
  markerRefs,
}: {
  centers: Vec3[];
  bloomed: Vec3[];
  markerRefs: React.RefObject<(HTMLDivElement | null)[]>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const factor = useExplode.getState().factor;
    for (let i = 0; i < centers.length; i += 1) {
      const el = markerRefs.current[i];
      if (el === null || el === undefined) continue;
      const a = centers[i]!;
      const b = bloomed[i]!;
      v.set(
        a[0] + (b[0] - a[0]) * factor,
        a[1] + (b[1] - a[1]) * factor,
        a[2] + (b[2] - a[2]) * factor,
      ).project(camera);
      const p = placeEdgeMarker({ x: v.x, y: v.y, z: v.z }, size.width, size.height);
      if (!p.offscreen) {
        el.style.display = "none";
      } else {
        el.style.display = "flex";
        el.style.transform = `translate(-50%, -50%) translate(${p.px}px, ${p.py}px)`;
      }
    }
  });

  return null;
}

/** Inside the Canvas: eases the live explode `factor` toward the `target` each
 *  frame (ADR 0091). Reads/writes the store imperatively so this node never
 *  re-renders, and stops touching state once it settles (no perpetual churn). */
function ExplodeAnimator() {
  useFrame((_, dt) => {
    const { factor, target, setFactor } = useExplode.getState();
    if (factor === target) return;
    const next = MathUtils.damp(factor, target, EXPLODE_LAMBDA, dt);
    setFactor(Math.abs(next - target) < 5e-3 ? target : next);
  });
  return null;
}

/** Inside the Canvas: mutates the single section `Plane` in place each frame off
 *  the live cut (ADR 0092). Reads the store imperatively (no subscription, no
 *  re-render); a no-op while the section is off (the clip set is empty then). */
function SectionPlaneRig({ plane, frame }: { plane: Plane; frame: SceneFrame }) {
  useFrame(() => {
    const { enabled, axis, position } = useSection.getState();
    if (!enabled) return;
    const { normal, constant } = sectionPlane(frame, axis, position);
    plane.normal.set(normal[0], normal[1], normal[2]);
    plane.constant = constant;
  });
  return null;
}

/** A framed square with a dashed cut line — the section/řez glyph. */
function SectionGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 13h16" strokeDasharray="2 2.5" />
    </svg>
  );
}

/** Four corner-arrows bursting outward — the explode/expand glyph (no icon lib,
 *  matching the `WarningGlyph` precedent). */
function ExplodeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 4H5v4M5 5l5 5" />
      <path d="M15 4h4v4M19 5l-5 5" />
      <path d="M9 20H5v-4M5 19l5-5" />
      <path d="M15 20h4v-4M19 19l-5-5" />
    </svg>
  );
}
