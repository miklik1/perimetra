"use client";

import * as React from "react";

import { useTranslations } from "@repo/i18n/web";
import {
  Alert,
  Icon,
  IconButton,
  Panel,
  SegmentedNav,
  SegmentedNavItem,
  Skeleton,
  Spinner,
  type IconName,
} from "@repo/ui";

import type { UiDerivation } from "./derive";
import { SitePlanSvg, WorkshopDrawingSvg } from "./drawing-svg";
import { useManipulation } from "./scene/manipulation";
import { SceneViewport } from "./scene/scene-viewport";
import type { BrandStep } from "./wizard-flow";

/**
 * The configurator's scene column (design/configurator/frames-v2.jsx `Scene()`,
 * :102-154): the viewport stage, the floating three-way view switch (:141-153)
 * and the corner watermark (:153). It replaces the old inline `Hero`, which
 * rendered exactly one representation per step and had no story at all for the
 * transitional states — a derive in flight showed a blank box and a failed
 * derive showed nothing.
 *
 * WHAT IS RENDERED IS DECIDED IN TWO INDEPENDENT AXES, never by boolean props:
 *
 *   1. the STAGE state — failed / pending / ready — narrowed once, at the root,
 *      into a discriminated union, so every downstream part receives a
 *      non-null `UiDerivation` and none of them re-checks;
 *   2. the VIEW — 3D · Výkres · Rozpad — owned here as local state and put on
 *      context, because the switch and the stage are sibling subtrees that both
 *      need it.
 *
 * Each cell of that product is an explicit variant component (`SceneBranch`,
 * `DrawingBranch`, `PlanBranch`, `BomBranch`, `NoGeometry`, `DeriveFailed`,
 * `Pending`) rather than a conditional inside one monolith.
 *
 * The BOM is a SLOT (`meta.bom`), not an import: `panels/bom-table.tsx` is
 * owned elsewhere and the column has no reason to know its shape.
 */

/** The three representations the column can show. Ours, not the kit's. */
type SceneView = "3d" | "drawing" | "bom";

/**
 * Stage state, narrowed ONCE. A failed derive outranks a stale result on
 * purpose: the geometry on screen no longer corresponds to the input the user
 * is looking at, so continuing to draw it would be a lie about what was
 * computed. Pending outranks nothing — it only applies when there is no prior
 * result to keep showing.
 */
type StageState =
  | { kind: "failed"; message: string }
  | { kind: "pending" }
  | { kind: "ready"; derivation: UiDerivation };

function stageStateOf(derivation: UiDerivation | null, error: string | null): StageState {
  if (error !== null) return { kind: "failed", message: error };
  if (derivation === null) return { kind: "pending" };
  return { kind: "ready", derivation };
}

interface SceneColumnState {
  view: SceneView;
  step: BrandStep;
  releaseId: string;
  webgl: boolean;
  /**
   * A derive is in flight. With a prior result on screen this is a
   * stale-while-revalidating hint (`ComputingChip`), never a replacement —
   * blanking a good scene on every keystroke is worse than showing it a beat
   * out of date.
   */
  computing: boolean;
}

interface SceneColumnActions {
  selectView: (view: SceneView) => void;
}

interface SceneColumnMeta {
  /** The BOM table, dependency-injected by the root. */
  bom: React.ReactNode;
}

interface SceneColumnContextValue {
  state: SceneColumnState;
  actions: SceneColumnActions;
  meta: SceneColumnMeta;
}

const SceneColumnContext = React.createContext<SceneColumnContextValue | null>(null);

function useSceneColumn(): SceneColumnContextValue {
  const ctx = React.use(SceneColumnContext);
  if (ctx === null) {
    throw new Error("Scene column parts must be rendered inside <SceneColumn>.");
  }
  return ctx;
}

export interface SceneColumnProps {
  step: BrandStep;
  derivation: UiDerivation | null;
  computing: boolean;
  error: string | null;
  releaseId: string;
  webgl: boolean;
  /** Slot — the root passes `<BomTable/>`; this file never imports it. */
  bom: React.ReactNode;
}

export function SceneColumn({
  step,
  derivation,
  computing,
  error,
  releaseId,
  webgl,
  bom,
}: SceneColumnProps): React.JSX.Element {
  const [view, setView] = React.useState<SceneView>("3d");
  const stage = stageStateOf(derivation, error);

  const context = React.useMemo<SceneColumnContextValue>(
    () => ({
      state: { view, step, releaseId, webgl, computing },
      actions: { selectView: setView },
      meta: { bom },
    }),
    [view, step, releaseId, webgl, computing, bom],
  );

  return (
    <SceneColumnContext value={context}>
      <SceneStage>
        {stage.kind === "failed" ? <DeriveFailed message={stage.message} /> : null}
        {stage.kind === "pending" ? <Pending /> : null}
        {stage.kind === "ready" ? <ReadyStage derivation={stage.derivation} /> : null}
      </SceneStage>
    </SceneColumnContext>
  );
}

/**
 * The positioning context every floating part (switch, watermark, chip, tint)
 * anchors to. `min-h-0` keeps it collapsible inside the root's grid column so a
 * tall drawing scrolls its own box instead of stretching the page.
 */
function SceneStage({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { state } = useSceneColumn();
  return (
    <div
      data-slot="scene-column"
      aria-busy={state.computing || undefined}
      className="relative h-full min-h-0 w-full"
    >
      {children}
    </div>
  );
}

/**
 * The ready stage: the selected representation, plus the two overlays that are
 * about the RESULT rather than about any one view.
 *
 * The invalid tint and the "no geometric truth" notice are deliberately kept
 * off the Rozpad branch. The canvas tints the SCENE (:133); a BOM is a data
 * table, and washing a price column in destructive red would cost legibility
 * to repeat something the issue list already says in words.
 */
function ReadyStage({ derivation }: { derivation: UiDerivation }): React.JSX.Element {
  const { state, meta } = useSceneColumn();
  return (
    <>
      {state.view === "bom" ? (
        <BomBranch>{meta.bom}</BomBranch>
      ) : (
        <>
          <GeometryBranch derivation={derivation} />
          {derivation.result.isValid ? null : <InvalidTint />}
        </>
      )}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <ViewSwitch />
        <FullscreenToggle />
      </div>
      {state.computing ? <ComputingChip /> : null}
    </>
  );
}

/**
 * Enter / exit the immersive edge-to-edge editor (ADR 0116). Reads the shared
 * manipulation store rather than a prop, so the same toggle serves both the
 * banded "Celá obrazovka" affordance and the immersive exit; the immersive
 * chrome carries a second, always-present exit ("Nastavení") so a later derive
 * failure — which unmounts this ready-stage control — can never trap the user.
 */
function FullscreenToggle(): React.JSX.Element {
  const t = useTranslations("configurator");
  const immersive = useManipulation((s) => s.immersive);
  const toggleImmersive = useManipulation((s) => s.toggleImmersive);
  return (
    <IconButton
      size="md"
      active={immersive}
      aria-pressed={immersive}
      aria-label={immersive ? t("exitImmersive") : t("enterImmersive")}
      onClick={toggleImmersive}
      className="pointer-coarse:size-11"
    >
      <Icon name={immersive ? "center" : "explode"} size={17} />
    </IconButton>
  );
}

/**
 * Which geometric representation this step shows.
 *
 * The step-plan override (ADR 0115) replaces the 3D branch IN PLACE — the plan
 * takes over the "3D" position rather than becoming a fourth segment. Two
 * reasons: the switch is a choice of REPRESENTATION (the live model / the
 * generated drawing / the parts), and on the footprint step the live model IS
 * the top-down plan; and a segment count that changed from step to step would
 * shift the other two targets under the pointer mid-flow. Výkres and Rozpad
 * keep working on that step untouched.
 */
function GeometryBranch({ derivation }: { derivation: UiDerivation }): React.JSX.Element {
  const { state } = useSceneColumn();
  if (state.view === "drawing") return <DrawingBranch derivation={derivation} />;
  if (state.step.plan) return <PlanBranch derivation={derivation} />;
  return <SceneBranch derivation={derivation} />;
}

/**
 * The 3D branch and its three-tier fallback chain, carried over from `Hero`:
 * live R3F → the pure SVG elevation when WebGL is unavailable → the notice when
 * there is no geometry at all. Tier 2 is a real fallback, not a degraded one:
 * the elevation is the same drawing the Výkres segment shows, so it is
 * watermarked as the drawing it is rather than pretending to be a live 3D view.
 */
function SceneBranch({ derivation }: { derivation: UiDerivation }): React.JSX.Element {
  const t = useTranslations("configurator");
  const { state } = useSceneColumn();

  if (state.webgl && derivation.scene !== undefined) {
    return (
      <>
        <SceneViewport key={state.releaseId} scene={derivation.scene} view={state.step.view} />
        <Watermark>{t("watermarkLive")}</Watermark>
      </>
    );
  }
  return <DrawingBranch derivation={derivation} />;
}

/** Výkres — the generated front elevation (`buildWorkshopDrawing`, I4). */
function DrawingBranch({ derivation }: { derivation: UiDerivation }): React.JSX.Element {
  const t = useTranslations("configurator");
  if (derivation.drawing === undefined) return <NoGeometry />;
  return (
    <>
      <Panel elevation="raised" className="h-full overflow-hidden">
        <WorkshopDrawingSvg drawing={derivation.drawing} className="h-full w-full" />
      </Panel>
      <Watermark>{t("watermarkDrawing")}</Watermark>
    </>
  );
}

/** Půdorys — the top-down site plan the first release-authored step frames. */
function PlanBranch({ derivation }: { derivation: UiDerivation }): React.JSX.Element {
  const t = useTranslations("configurator");
  if (derivation.plan === undefined) return <NoGeometry />;
  return (
    <>
      <Panel elevation="raised" padded={false} className="h-full overflow-hidden p-4">
        <SitePlanSvg plan={derivation.plan} className="h-full w-full" />
      </Panel>
      <Watermark>{t("watermarkDrawing")}</Watermark>
    </>
  );
}

/** Rozpad — the injected BOM table. No watermark: nothing is being rendered. */
function BomBranch({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="h-full w-full overflow-auto">{children}</div>;
}

/**
 * An invalid configuration has no geometric truth to draw (I5) — the engine
 * emits no scene, no drawing and no plan for it, so this is a statement of
 * absence, not a failure to render. `role="status"` (polite): the errors
 * themselves are announced by the issue list, and interrupting for the
 * second-order consequence would be noise.
 */
function NoGeometry(): React.JSX.Element {
  const t = useTranslations("configurator");
  return (
    <div className="bg-field-raised shadow-soft flex h-full w-full items-center justify-center overflow-hidden rounded-2xl p-6">
      <p role="status" className="text-muted-foreground text-ui-base max-w-sm text-center">
        {t("sceneInvalid")}
      </p>
    </div>
  );
}

/**
 * The canvas' invalid wash (:133) — `color-mix(in srgb, destructive 5%,
 * transparent)` is exactly what `bg-destructive/5` compiles to. Decorative
 * (`aria-hidden`, the state is stated in words above) and
 * `pointer-events-none`, so it never swallows a click on the scene beneath it.
 */
function InvalidTint(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="bg-destructive/5 pointer-events-none absolute inset-0 rounded-2xl"
    />
  );
}

/**
 * A derive is in flight and there is NO prior result to keep showing — the
 * first derive of a session, or the first after a failure. A blank box here
 * reads as "this product has no preview"; a scene-shaped pulse reads as
 * "the preview is coming". `role="status"` carries the polite announcement,
 * and the pulse itself is decorative.
 */
function Pending(): React.JSX.Element {
  const t = useTranslations("configurator");
  return (
    <div
      role="status"
      aria-busy="true"
      className="bg-field-raised shadow-soft relative h-full w-full overflow-hidden rounded-2xl"
    >
      <Skeleton aria-hidden="true" className="rounded-card absolute inset-[12%]" />
      <span className="text-muted-foreground text-ui-sm absolute inset-x-0 bottom-6 text-center">
        {t("computing")}
      </span>
    </div>
  );
}

/**
 * A derive is in flight OVER a prior result. Deliberately a small corner chip
 * and not a scrim: the stale scene stays readable and interactive while the new
 * one computes. `SceneStage` already carries `aria-busy`; this is the visible
 * half of the same statement.
 */
function ComputingChip(): React.JSX.Element {
  const t = useTranslations("configurator");
  return (
    <p
      role="status"
      className="bg-chrome text-muted-foreground shadow-soft rounded-control text-ui-sm absolute left-4 top-4 z-10 inline-flex items-center gap-2 px-3 py-1.5 font-medium"
    >
      <Spinner aria-hidden="true" className="size-3.5" />
      {t("computing")}
    </p>
  );
}

/**
 * The derive threw. `Alert tone="destructive"` derives `role="alert"` from the
 * tone, which is the right urgency: unlike an invalid configuration (a normal,
 * expected state the user is working through) this is a broken compute path and
 * nothing on the step can be trusted until it clears.
 */
function DeriveFailed({ message }: { message: string }): React.JSX.Element {
  const t = useTranslations("configurator");
  return (
    <div className="bg-field-raised shadow-soft flex h-full w-full items-center justify-center overflow-hidden rounded-2xl p-6">
      <Alert tone="destructive" className="max-w-md">
        <Alert.Icon />
        <Alert.Title>{t("deriveFailed")}</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
      </Alert>
    </div>
  );
}

/**
 * The floating view switch (:141-153). Rendered only in the ready stage — with
 * nothing derived there is nothing to switch BETWEEN, and a control that
 * visibly does nothing when pressed is worse than one that arrives with its
 * content.
 */
function ViewSwitch(): React.JSX.Element {
  const t = useTranslations("configurator");
  const { state, actions } = useSceneColumn();
  return (
    <SegmentedNav
      // `SegmentedNav` is a page-navigation control by default: it renders a
      // `<nav>` landmark and marks the selected item `aria-current="page"`.
      // This is a VIEW SWITCH, so both are factually wrong — a screen-reader
      // user would hear "Rozpad, current page" for a control that changes no
      // page. Re-stated here, through the props the kit already spreads, as a
      // labelled GROUP of toggle buttons: native `<button>` keyboard operation
      // (Tab to reach, Enter/Space to press), no roving tabindex to get wrong.
      // The kit should grow a non-navigation variant — see the slice report.
      role="group"
      aria-label={t("viewSwitchLabel")}
      value={state.view}
      // The kit's contract is the generic `(value: string)`; the three values
      // in this group are authored right below, so this narrows what we wrote.
      // Positioning now lives on the top-right cluster in `ReadyStage` (it shares
      // the row with the fullscreen toggle), so the nav itself is unpositioned.
      onValueChange={(value) => actions.selectView(value as SceneView)}
    >
      <ViewSwitchItem view="3d" icon="cube" label={t("view3d")} />
      <ViewSwitchItem view="drawing" icon="draft" label={t("viewDrawing")} />
      <ViewSwitchItem view="bom" icon="list" label={t("viewBom")} />
    </SegmentedNav>
  );
}

function ViewSwitchItem({
  view,
  icon,
  label,
}: {
  view: SceneView;
  icon: IconName;
  label: string;
}): React.JSX.Element {
  const { state } = useSceneColumn();
  return (
    <SegmentedNavItem
      value={view}
      icon={<Icon name={icon} size={16} />}
      label={label}
      aria-current={undefined}
      aria-pressed={state.view === view}
      // The kit's pill is ~30px tall; `pointer-coarse:` lifts it to the 44px
      // WCAG 2.5.5 target on touch, the same idiom Button/Toast already use.
      className="pointer-coarse:min-h-11"
    />
  );
}

/**
 * The corner watermark (:153) — 11px uppercase muted, per the canvas. Purely
 * decorative: it names the representation the segment control already names,
 * so it is hidden from assistive tech rather than repeated into it.
 */
function Watermark({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      // `hidden md:block`: the scene viewport renders its own environment pills
      // along the bottom edge, and on a phone-width scene the two collide. The
      // watermark is decorative and the segment control already names the view,
      // so it yields rather than overlapping a real control.
      className="text-muted-foreground text-ui-xs absolute bottom-4 right-4 hidden font-semibold uppercase tracking-[0.08em] md:block"
    >
      {children}
    </span>
  );
}
