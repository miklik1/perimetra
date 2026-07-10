import { notFound } from "next/navigation";

import { DrawingLabClient, type Family } from "./drawing-lab-client";

/**
 * `/drawing-lab` — the dev-only headless 2D verification route (ADR 0102, sibling
 * of `/scene-lab`). It derives a fixture family in-browser and renders the real
 * `TechnicalDrawingSvg`, so `scripts/verify/capture-drawing.mjs` screenshots the
 * actual emitter → SVG path (the standing "never call a render correct without
 * eyes on it" rule, for 2D). Hard-404 in production so it never ships live.
 *
 * The `?scene=` family is resolved SERVER-side (unlike `/scene-lab`, whose canvas
 * is client-only): this route SSRs a real SVG, so the capture must be selected in
 * the initial render, not by a post-hydration effect.
 */
export const dynamic = "force-dynamic";

export default async function DrawingLabPage({
  searchParams,
}: {
  searchParams: Promise<{ scene?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { scene } = await searchParams;
  const family: Family = scene === "fence-run" ? "fence-run" : "branka";
  return <DrawingLabClient family={family} />;
}
