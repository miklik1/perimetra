/**
 * @repo/renderers — cut list / 3D scene / 2D drawings off the site graph
 * (CORE_SPEC §9, step 5). Every function here consumes DERIVED results (plus
 * the Site's own input poses) and emits pure data: no renderer recomputes
 * geometry from raw config (I4), no function does I/O (I1). PDF/SVG/R3F are
 * presentation adapters in app land — they draw these shapes, nothing more.
 */
export * from "./cutlist.js";
export * from "./drawing2d.js";
export * from "./nabidka.js";
export * from "./scene3d.js";
export { add, consumedParts, cosArcMin, sinArcMin, rotate, type Pt, type Vec3 } from "./shared.js";
