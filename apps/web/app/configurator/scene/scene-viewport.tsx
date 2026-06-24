"use client";

import dynamic from "next/dynamic";

import { useTranslations } from "@repo/i18n/web";
import type { Scene3D } from "@repo/renderers";

/**
 * Lazy 3D boundary: three.js stays out of the initial bundle (gates pattern —
 * `ssr: false` + dynamic import) and jsdom tests never touch WebGL. An
 * invalid configuration has no scene (I5) — the viewport says so instead of
 * rendering a stale or empty world.
 */
const SceneCanvas = dynamic(() => import("./scene-canvas"), {
  ssr: false,
  loading: () => <ViewportNote messageKey="sceneLoading" />,
});

function ViewportNote({ messageKey }: { messageKey: "sceneLoading" | "sceneInvalid" }) {
  const t = useTranslations("configurator");
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      {t(messageKey)}
    </div>
  );
}

export function SceneViewport({ scene }: { scene: Scene3D | undefined }) {
  return (
    <div className="bg-field-raised shadow-soft h-[420px] overflow-hidden rounded-2xl">
      {scene === undefined ? (
        <ViewportNote messageKey="sceneInvalid" />
      ) : (
        <SceneCanvas scene={scene} />
      )}
    </div>
  );
}
