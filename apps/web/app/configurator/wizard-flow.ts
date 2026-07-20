/**
 * The brand wizard spine (ADR 0077 technique 6 — the Bombardier UX grammar —
 * as amended by the ADR 0114 design wave). Three app-shell steps wrap the
 * release's OWN authored `ui.steps`: Produkt · «release steps» · Barva a povrch ·
 * Souhrn.
 *
 * What changed, and why. ADR 0077 shipped a FIXED five-step spine that harvested
 * the release's authored steps and re-slotted them positionally — the first
 * authored step seeded "Lokalita", every remaining one was flattened into
 * "Konfigurace". That discarded the release's own step identity: a release
 * authoring five meaningful steps rendered as two, under app-land labels. The
 * design canvas draws seven steps against that five, and CORE_SPEC §8 makes the
 * release the author of its own UI, so the spine now renders `resolveUi`'s steps
 * ONE-TO-ONE, carrying each step's authored id and label. The same structure the
 * in-project editor (`wizard.tsx`, reached from `/site/:projectId`) has always
 * rendered — the two step models were incompatible and are now one.
 *
 * `UiStep` carries only `id`, `label` and `groups` (no camera hint, no view
 * hint), so ADR 0077's two presentation features need a rule for steps the
 * release authored. Both are a POSITIONAL CARRY-OVER of the shipped behaviour,
 * deliberately chosen over flattening the choreography and over widening the
 * schema (Martin, 2026-07-20):
 *
 *   - The FIRST release-authored step keeps what "Lokalita" had — the site-plan
 *     SVG rather than the 3D scene (`plan: true`), framed by the `hero` pose.
 *     It is the dimensions/footprint step in every authored release, which is
 *     exactly why ADR 0077 seeded Lokalita from it.
 *   - Every later release step gets the `detail` pose, as "Konfigurace" did.
 *   - The three shell steps keep their ADR 0077 poses unchanged.
 *
 * The wart this leaves is honest and recorded: presentation still resolves
 * positionally even though content no longer does. Letting a release author its
 * own camera and view is Option C — a `packages/model` schema change with a
 * publish-gate impact — and is deferred behind its own ADR.
 */
import type { ResolvedUiGroup, ResolvedUiStep } from "@repo/model";

import type { CameraView } from "./scene/camera-poses";

/**
 * `release` is every step the release authored; the other three are app-shell
 * steps (product pick / finish / save-to-project, CAR-22) carrying no release
 * parameters. Shell steps label from i18n via `STEP_LABEL`; a release step
 * labels from its own authored `label`.
 */
export type BrandStepKind = "produkt" | "release" | "barva" | "souhrn";

export interface BrandStep {
  kind: BrandStepKind;
  /** Stable identity for step nav — the authored step id for release steps. */
  id: string;
  /** The camera pose this step frames. Ignored while `plan` is true. */
  view: CameraView;
  /**
   * Render the top-down site-plan SVG instead of the 3D scene. True for the
   * first release-authored step only (the ADR 0077 "Lokalita" carry-over).
   */
  plan: boolean;
  /** The release's authored label; undefined for shell steps. */
  label?: string;
  /** Release-authored groups rendered in the body (empty for shell steps). */
  groups: ResolvedUiGroup[];
}

/**
 * A collision-free key for step navigation. `id` alone is not safe: a release
 * authors its step ids freely and publish validation only enforces uniqueness
 * WITHIN the spec, so a release authoring a step called "produkt" would collide
 * with the shell step of that name and the nav would jump to the wrong step.
 * Kind plus id is unique by construction.
 */
export function flowKey(step: BrandStep): string {
  return `${step.kind}:${step.id}`;
}

export function buildFlow(steps: ResolvedUiStep[]): BrandStep[] {
  const releaseSteps: BrandStep[] = steps.map((step, index) => ({
    kind: "release",
    id: step.id,
    view: index === 0 ? "hero" : "detail",
    plan: index === 0,
    label: step.label,
    groups: step.groups,
  }));

  return [
    { kind: "produkt", id: "produkt", view: "hero", plan: false, groups: [] },
    ...releaseSteps,
    { kind: "barva", id: "barva", view: "front", plan: false, groups: [] },
    { kind: "souhrn", id: "souhrn", view: "pullback", plan: false, groups: [] },
  ];
}
