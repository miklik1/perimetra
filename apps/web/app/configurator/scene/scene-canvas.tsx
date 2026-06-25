"use client";

import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace, Vector3, type Vector3Tuple } from "three";

import { useTranslations } from "@repo/i18n/web";
import type { Scene3D, Vec3 } from "@repo/renderers";
import { Badge, IconButton } from "@repo/ui";

import { useDeviation } from "./deviation";
import { deviatedPieceCenters, placeEdgeMarker } from "./deviation-markers";
import { frameScene } from "./frame";
import { SceneRenderer } from "./scene-renderer";

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
 * Deviation surfacing (ADR 0076, CORE_SPEC §6): every deviated piece gets a
 * ref-driven DOM **edge marker** that rides the viewport edge when the piece
 * leaves the frustum (the per-frame `vec3.project(camera)` lives in
 * `DeviationProjector`; the pure clamp math + world centres in
 * `deviation-markers.ts`) — so NO camera angle can hide a deviated piece. The
 * highlight toggle drives the emissive/desaturate emphasis (`scene-renderer`).
 */
export default function SceneCanvas({
  scene,
  cam = "default",
}: {
  scene: Scene3D;
  cam?: "default" | "away";
}) {
  const t = useTranslations("configurator");
  const frame = useMemo(() => frameScene(scene), [scene]);
  const deviatedCenters = useMemo(() => deviatedPieceCenters(scene), [scene]);
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const highlight = useDeviation((s) => s.highlight);
  const toggleHighlight = useDeviation((s) => s.toggle);

  const keyLight: Vector3Tuple = [
    frame.center[0] + frame.radius,
    frame.center[1] + frame.radius * 1.6,
    frame.center[2] + frame.radius,
  ];

  // `cam="away"` (the e2e off-screen check, ADR 0076): point the camera AWAY from
  // the scene so every deviated piece is behind the frustum — the §6 guarantee
  // must still surface a marker. The look-at is the camera position reflected
  // through the scene centre, so the gate sits squarely behind the camera.
  const away = cam === "away";
  const cameraPosition: Vec3 = away
    ? [
        frame.center[0] + frame.radius * 1.4,
        frame.center[1] + frame.radius * 0.5,
        frame.center[2] + frame.radius * 1.4,
      ]
    : frame.cameraPosition;
  const target: Vec3 = away
    ? [
        2 * cameraPosition[0] - frame.center[0],
        2 * cameraPosition[1] - frame.center[1],
        2 * cameraPosition[2] - frame.center[2],
      ]
    : frame.center;

  return (
    <div className="relative h-full w-full">
      <Canvas
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          outputColorSpace: SRGBColorSpace,
        }}
        camera={{ fov: 45, near: 10, far: 120000, position: cameraPosition }}
        dpr={[1, 2]}
      >
        {/* The Bombardier warm-grey field (brand `--color-field`); IBL stays invisible above it. */}
        <color attach="background" args={["#ededed"]} />

        {/* Soft floor so shadowed faces never crush to black — the IBL carries the fill. */}
        <ambientLight intensity={0.3} />
        {/* One warm key for directional modelling + specular pop on the profile edges. */}
        <directionalLight position={keyLight} intensity={1.6} color="#fff6ec" />

        <SceneRenderer scene={scene} />

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

        {/* §6: per-frame projection of each deviated piece → its DOM edge marker. */}
        {deviatedCenters.length > 0 && (
          <DeviationProjector centers={deviatedCenters} markerRefs={markerRefs} />
        )}

        <OrbitControls makeDefault target={target} />
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
 *  marker by ref (visibility + clamped edge position). No React state per frame. */
function DeviationProjector({
  centers,
  markerRefs,
}: {
  centers: Vec3[];
  markerRefs: React.RefObject<(HTMLDivElement | null)[]>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new Vector3(), []);

  useFrame(() => {
    for (let i = 0; i < centers.length; i += 1) {
      const el = markerRefs.current[i];
      if (el === null || el === undefined) continue;
      const c = centers[i]!;
      v.set(c[0], c[1], c[2]).project(camera);
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
