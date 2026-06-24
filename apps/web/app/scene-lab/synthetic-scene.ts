/**
 * A synthetic `Scene3D` for the headless 3D verification harness (ADR 0073) —
 * a hand-built gate (posts + rails + flat pickets, one piece flagged deviated)
 * that exercises the real `buildScene` output contract (ScenePiece) and every
 * extrudable profile, WITHOUT the auth + api + engine stack. The `/scene-lab`
 * route renders the SAME `SceneCanvas` pipeline the configurator uses, so a
 * screenshot proves the render path end-to-end (extrusion, lighting, the §6
 * amber) — see `scripts/verify/capture-scene.mjs`. Dev-only; never shipped.
 */
import type { Scene3D, ScenePiece, Vec3 } from "@repo/renderers";

const ARCMIN_QUARTER = 5400; // 90° about Z turns local +X (axis) to +Y (up).

const POST: ScenePiece["profile"] = { shape: "rect_tube", wMm: 60, dMm: 60 };
const RAIL: ScenePiece["profile"] = { shape: "rect_tube", wMm: 40, dMm: 20 };
const PICKET: ScenePiece["profile"] = { shape: "flat", wMm: 100 };

const WIDTH = 3000;
const HEIGHT = 1500;
const RAIL_INSET = 120;

export function syntheticGate(): Scene3D {
  const pieces: ScenePiece[] = [];
  const vertical: Vec3 = [0, 0, ARCMIN_QUARTER];
  const flat: Vec3 = [0, 0, 0];

  // Two posts (vertical rect_tube), left + right.
  for (const x of [0, WIDTH]) {
    pieces.push({
      id: `post@${x}`,
      componentCode: "jakl_60x60",
      name: "Sloupek",
      lengthMm: HEIGHT,
      profile: POST,
      at: [x, 0, 0],
      rotationArcMin: vertical,
    });
  }

  // Top + bottom rails (horizontal rect_tube) spanning the opening.
  for (const y of [RAIL_INSET, HEIGHT - RAIL_INSET]) {
    pieces.push({
      id: `rail@${y}`,
      componentCode: "jakl_40x20",
      name: "Příčník",
      lengthMm: WIDTH,
      profile: RAIL,
      at: [0, y, 0],
      rotationArcMin: flat,
    });
  }

  // Vertical flat pickets across the opening; flag one as deviated (§6 amber).
  const count = 9;
  const gap = WIDTH / (count + 1);
  for (let i = 1; i <= count; i += 1) {
    pieces.push({
      id: `picket@${i}`,
      componentCode: "planka_100",
      name: "Výplň",
      lengthMm: HEIGHT - 2 * RAIL_INSET,
      profile: PICKET,
      at: [i * gap, RAIL_INSET, 0],
      rotationArcMin: vertical,
      ...(i === 5 && { deviated: true }),
    });
  }

  return {
    units: "mm",
    instances: [
      {
        instanceId: "scene-lab",
        releaseId: "scene-lab@1",
        at: [0, 0, 0],
        rotationArcMin: [0, 0, 0],
        pieces,
      },
    ],
  };
}
