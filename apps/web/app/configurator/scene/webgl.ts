"use client";

/**
 * WebGL availability probe (ADR 0077) — when the browser/GPU can't give a WebGL
 * context, the hybrid viewport falls back to the pure-SVG technical drawing
 * (`drawing2d.ts`) instead of a dead canvas. Guarded for SSR (no `document`).
 */
export function webglAvailable(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (window.WebGLRenderingContext === undefined) return false;
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}
