/**
 * The 5-step brand wizard spine (ADR 0077, technique 6 — the Bombardier UX
 * grammar). A fixed CZ flow — Produkt · Lokalita · Konfigurace · Barva a povrch ·
 * Souhrn — wraps the release's OWN authored `ui.steps`, so CORE_SPEC §8 holds:
 * the brand SHELL is app-land, but every parameter's label, domain, options, and
 * GROUP grouping still come from release data (rendered as the body of the
 * Lokalita + Konfigurace steps).
 *
 * §8 reconciliation (documented in ADR 0077): the design note's "Výplň" maps to
 * "Konfigurace" because a release authors more than just an infill choice — the
 * body steps carry whatever the release grouped. The split is data-driven, never
 * keyed on specific parameters: the release's FIRST authored step seeds Lokalita
 * (the dimensions/site footprint), the REST seed Konfigurace. Produkt / Barva a
 * povrch / Souhrn are app-shell steps (product pick / finish / save-to-project,
 * CAR-22) with no release params.
 */
import type { ResolvedUiGroup, ResolvedUiStep } from "@repo/model";

import type { CameraView } from "./scene/camera-poses";

export type BrandStepKind = "produkt" | "lokalita" | "konfigurace" | "barva" | "souhrn";

export interface BrandStep {
  kind: BrandStepKind;
  /** The camera pose this step frames (R3F steps); Lokalita uses the SVG plan. */
  view: CameraView;
  /** Release-authored groups rendered in the body (empty for shell steps). */
  groups: ResolvedUiGroup[];
}

export function buildFlow(steps: ResolvedUiStep[]): BrandStep[] {
  const lokalitaGroups = steps[0]?.groups ?? [];
  const konfiguraceGroups = steps.slice(1).flatMap((s) => s.groups);
  return [
    { kind: "produkt", view: "hero", groups: [] },
    { kind: "lokalita", view: "hero", groups: lokalitaGroups },
    { kind: "konfigurace", view: "detail", groups: konfiguraceGroups },
    { kind: "barva", view: "front", groups: [] },
    { kind: "souhrn", view: "pullback", groups: [] },
  ];
}
