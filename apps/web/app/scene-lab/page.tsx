import { notFound } from "next/navigation";

import { SceneLabClient } from "./scene-lab-client";

/**
 * `/scene-lab` — the dev-only headless 3D verification route (ADR 0073). It
 * renders the configurator's `SceneCanvas` against a synthetic gate with no
 * auth/api, so `scripts/verify/capture-scene.mjs` can screenshot the real
 * render pipeline. Hard-404 in production so it never ships as a live surface.
 */
export const dynamic = "force-dynamic";

export default function SceneLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SceneLabClient />;
}
