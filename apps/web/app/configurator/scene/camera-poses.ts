/**
 * Named camera poses for the step-to-step choreography (ADR 0077, technique 6 —
 * spatial progression, not a progress bar). Pure: a `SceneFrame` (AABB fit) +
 * a view name → a `{position, target}` the `CameraControls` rig animates to with
 * `setLookAt(…, true)`. No three.js, so the pose geometry is unit-testable.
 *
 * The wizard maps each brand step to a view (Produkt→hero, Konfigurace→detail,
 * Barva→front, Souhrn→pullback); `away` is the e2e off-screen pose (the §6
 * marker check) — the gate sits squarely behind the camera.
 */
import type { Vec3 } from "@repo/renderers";

import type { SceneFrame } from "./frame";

export type CameraView = "hero" | "front" | "detail" | "pullback" | "away" | "exploded";

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export function cameraPose(view: CameraView, frame: SceneFrame): CameraPose {
  const [cx, cy, cz] = frame.center;
  const r = frame.radius;

  switch (view) {
    case "front":
      // Near-straight-on elevation — the flat product shot to judge colour.
      return { position: [cx, cy + r * 0.15, cz + r * 2.3], target: frame.center };
    case "detail":
      // A lower, more frontal three-quarter that still fits the whole gate — the
      // working view for Konfigurace (you edit and watch the full product move).
      // Kept at ~hero distance so a wide gate never crops out of frame.
      return { position: [cx + r * 0.45, cy + r * 0.28, cz + r * 2.05], target: frame.center };
    case "pullback":
      // The Summary reveal — pulled back, generous three-quarter.
      return { position: [cx + r * 1.15, cy + r * 0.95, cz + r * 2.7], target: frame.center };
    case "exploded":
      // The §9 exploded reveal (ADR 0091): a pulled-back isometric three-quarter
      // that frames the bloomed assembly (which grows the AABB by ~the explode
      // spread), so every separated piece stays in shot. Distances are tuned for
      // DEFAULT_EXPLODE_SPREAD; the camera stays user-interruptible (ADR 0077).
      return { position: [cx + r * 2.9, cy + r * 2.3, cz + r * 2.9], target: frame.center };
    case "away": {
      // Point the camera AWAY: the look-at is the position reflected through the
      // centre, so the scene is squarely behind the frustum (the §6 e2e check).
      const position: Vec3 = [cx + r * 1.4, cy + r * 0.5, cz + r * 1.4];
      return {
        position,
        target: [2 * position[0] - cx, 2 * position[1] - cy, 2 * position[2] - cz],
      };
    }
    case "hero":
    default:
      // The default AABB-fit three-quarter hero.
      return { position: frame.cameraPosition, target: frame.center };
  }
}
