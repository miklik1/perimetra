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

// Drawing emitter (spike, ADR pending) — 2D technical drawing as a derived view
// off the one geometry SoT (SolidModeler → Sectioner → ViewProjector → …).
export * from "./drawing/types.js";
export {
  profileEnvelope,
  sectionOutline,
  type ProfileEnvelope,
} from "./drawing/profile-library.js";
export { buildSolids } from "./drawing/solid.js";
export { renderView, FRONT_VIEW, SIDE_VIEW, TOP_VIEW } from "./drawing/project.js";
export { annotate, type AnnotationIntent } from "./drawing/annotate.js";
export { place, type PlacedAnnotation } from "./drawing/dimsolve.js";
export { buildTechnicalDrawing, type TechnicalDrawing } from "./drawing/drawing.js";
