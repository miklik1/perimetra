"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AuthGuard } from "@repo/auth/react";
import type { ConfigInput } from "@repo/engine";
import { useLocale, useTranslations } from "@repo/i18n/web";
import {
  resolveUi,
  type Catalog,
  type OptionSet,
  type ResolvedUiGroup,
  type Scope,
  type Value,
} from "@repo/model";
import { Button, cn, DisplayLabel, Panel, StepProgress, StickyActionBar } from "@repo/ui";

import { formatMoney } from "../../lib/format-money";
import { marginPct } from "../../lib/margin";
import { useCanSeeCost, usePriceBlind } from "../../lib/use-role";
import { decodeConfig, encodeConfig } from "./config-hash";
import { FinishPicker } from "./finish-picker";
import { ImmersiveChrome } from "./immersive-chrome";
import { useConfiguratorDerive } from "./lib/use-configurator-derive";
import { BomTable } from "./panels/bom-table";
import { CommercialPanel } from "./panels/commercial-panel";
import { ParamField } from "./param-field";
import type { CatalogBundle, ConfigurableProduct, ConfiguratorPricing } from "./products";
import { SceneColumn } from "./scene-column";
import { dimensionBindings, useManipulation } from "./scene/manipulation";
import { webglAvailable } from "./scene/webgl";
import { ContextBar } from "./shell/context-bar";
import { StepChips } from "./shell/step-chips";
import { StepsRail, type RailItem } from "./shell/steps-rail";
import { formatValue, Summary } from "./summary";
import { buildFlow, flowKey, type BrandStep, type BrandStepKind } from "./wizard-flow";

/**
 * The generated configurator (CORE_SPEC §8), wearing the ADR 0114 design canvas
 * (`design/configurator/frames-v2.jsx`) over the ADR 0115 step model.
 *
 * The shell is one responsive layout across three bands rather than three
 * layouts, because they are the same surface at three widths and the canvas
 * draws them as separate frames only because a static export cannot show a
 * breakpoint:
 *
 *   - **lg+ (v2-OPT / v2-INV)** — vertical 210px steps rail · 400px form column ·
 *     scene fills the rest.
 *   - **md–lg (v2-TAB, tablet on-site)** — steps promote to a horizontal chip
 *     row, the form column narrows, and commerce moves to a sticky bottom bar
 *     with coarse-pointer targets.
 *   - **< md (v2-MOB)** — the scene takes the top, the form becomes a bottom
 *     sheet, and the steps reduce to `StepProgress` dots.
 *
 * The immersive frame (v2-IMM) IS here now (ADR 0116): `immersive` (a slice of
 * the manipulation store) promotes the scene `<main>` to full-bleed and hides
 * the banded chrome, without remounting the WebGL canvas. The §7.6
 * direct-manipulation loop — corner-handle width drag, editable dimension pills,
 * part picking — lives in the scene layer (`scene/manipulation*`), fed by the
 * bridge this component syncs. Měřit/Otočit are deferred (Martin's scope call).
 *
 * Catalog/releases/active pricing are served by the api (ADR 0060): the RSC
 * fetches the bundle and prop-passes it here. The derive runs on the engine
 * worker (ADR 0116, §7.6 — never the main thread).
 */

/** Brand step → its CZ pill label key (literal union for the typed `t`). */
/**
 * Only the three app-shell steps label from i18n. A release-authored step
 * labels from its OWN `label` (CORE_SPEC §8 — the release authors its UI), so
 * it is deliberately absent from this map.
 */
const STEP_LABEL = {
  produkt: "stepProdukt",
  barva: "stepBarva",
  souhrn: "stepSouhrn",
} as const satisfies Record<Exclude<BrandStepKind, "release">, string>;

/** Shell steps read their label from the catalog; release steps carry their own. */
function stepLabel(
  step: BrandStep,
  t: (key: (typeof STEP_LABEL)[keyof typeof STEP_LABEL]) => string,
): string {
  return step.kind === "release" ? (step.label ?? step.id) : t(STEP_LABEL[step.kind]);
}

export function ConfiguratorClient({ bundle }: { bundle: CatalogBundle | null }) {
  const router = useRouter();
  const t = useTranslations("configurator");

  const notice = (message: string) => (
    <Field>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
        <DisplayLabel as="h1" className="text-4xl sm:text-5xl">
          {t("title")}
        </DisplayLabel>
        <Panel className="text-muted-foreground p-8 text-center">{message}</Panel>
      </main>
    </Field>
  );

  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <Field>
          <main className="text-muted-foreground flex min-h-screen items-center justify-center">
            {t("checkingSession")}
          </main>
        </Field>
      }
    >
      {bundle === null || bundle.products.length === 0 || bundle.catalogs.size === 0 ? (
        notice(t("noProducts"))
      ) : bundle.pricing === null ? (
        // Empty-but-honest (ADR 0063): a fabricator's prices are their own data,
        // so with no active table the surface says so rather than deriving a zero.
        // This is also the workshop's 403 path (ADR 0056).
        notice(t("noPrices"))
      ) : (
        <ConfiguratorInner
          products={bundle.products}
          catalogs={bundle.catalogs}
          pricing={bundle.pricing}
        />
      )}
    </AuthGuard>
  );
}

/** The warm-grey full-bleed field the whole configurator floats on (ADR 0072). */
function Field({ children }: { children: React.ReactNode }) {
  return <div className="bg-field min-h-screen">{children}</div>;
}

function ConfiguratorInner({
  products,
  catalogs,
  pricing,
}: {
  products: ConfigurableProduct[];
  catalogs: ReadonlyMap<string, Catalog>;
  pricing: ConfiguratorPricing;
}) {
  const t = useTranslations("configurator");
  const priceBlind = usePriceBlind();
  const canSeeCost = useCanSeeCost();

  const [productIndex, setProductIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [input, setInput] = useState<ConfigInput>(() => ({ ...products[0]!.initialInput }));
  const [webgl, setWebgl] = useState(true);

  // Restore a shared configuration (`?c=`, ADR 0077) once on mount, and probe
  // WebGL (the hero falls back to the SVG drawing when unavailable).
  useEffect(() => {
    setWebgl(webglAvailable());
    const token = new URLSearchParams(window.location.search).get("c");
    if (token === null) return;
    const shared = decodeConfig(token);
    if (shared === null) return;
    const index = products.findIndex((p) => p.release.id === shared.releaseId);
    if (index >= 0) {
      setProductIndex(index);
      setInput(shared.input);
    }
  }, [products]);

  const immersive = useManipulation((s) => s.immersive);

  const product = products[productIndex]!;
  const { derivation, computing, error, requestImmediate } = useConfiguratorDerive(
    product,
    catalogs,
    pricing,
    input,
  );
  const result = derivation?.result ?? null;

  const steps = useMemo(
    () => resolveUi(product.release, derivation?.scope ?? input),
    [product.release, derivation?.scope, input],
  );
  const flow = useMemo(() => buildFlow(steps), [steps]);

  // The dimension parameters the immersive handles/pills address (ADR 0116,
  // §7.6). By position: the first two VISIBLE `range`-domain parameters with
  // bounds are the width and height. A release does not author which parameter is
  // a spatial dimension, so this is a heuristic (recorded as a deviation); a
  // parameter with no bounds cannot clamp a drag and is skipped, and a dimension
  // with no such parameter yields a null binding whose pill/handle is not shown.
  const dimensionRanges = useMemo(() => {
    const ranges: { key: string; label: string; min: number; max: number; step: number }[] = [];
    for (const group of steps.flatMap((s) => s.groups)) {
      for (const { def, visible } of group.params) {
        if (!visible || def.domain?.kind !== "range") continue;
        const { min, max, step } = def.domain;
        if (typeof min !== "number" || typeof max !== "number") continue;
        ranges.push({ key: def.key, label: def.label ?? def.key, min, max, step: step ?? 10 });
        if (ranges.length === 2) return ranges;
      }
    }
    return ranges;
  }, [steps]);

  // Clamp rather than fall back. `flow.length` is release-authored and therefore
  // VARIABLE (ADR 0115) where it used to be a constant 5, so a step index can
  // outlive the flow that produced it — on a product switch, or on a release
  // whose `relevance` drops a step. The previous `flow[stepIndex] ?? flow[0]`
  // silently showed the FIRST step while the nav still highlighted the stale
  // index, so body and nav disagreed. Clamping keeps them one value.
  const activeIndex = Math.min(stepIndex, flow.length - 1);
  const step = flow[activeIndex]!;
  const activeKey = flowKey(step);

  const shareToken = useMemo(
    () => encodeConfig({ releaseId: product.release.id, input }),
    [product.release.id, input],
  );

  const railItems = useRailItems(
    flow,
    activeIndex,
    input,
    derivation?.scope,
    product.release.optionSets ?? [],
    t,
  );

  const switchProduct = (index: number) => {
    // The selection references the outgoing release's parts; clear it before the
    // scene remounts on the new release (ADR 0116).
    useManipulation.getState().setSelected(null);
    setProductIndex(index);
    setStepIndex(0);
    setInput({ ...products[index]!.initialInput });
  };

  const setValue = (key: string, value: Value | undefined) => {
    setInput((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  // The manipulation store starts each session banded and unselected, and is
  // fully cleared when the surface unmounts (ADR 0116). `reset()` keeps the
  // bridge — the sync effect below re-sets it the same commit — so the overlay
  // never sees a null-bridge frame on mount. Resetting on UNMOUNT too matters
  // because the store is a module singleton: without it, leaving `/configurator`
  // in immersive mode and returning would paint one fullscreen frame before the
  // mount effect reverted to banded. Clearing immersive on the way out means the
  // next mount's first render is already banded.
  useEffect(() => {
    useManipulation.getState().reset();
    return () => {
      const m = useManipulation.getState();
      m.reset();
      m.setBridge(null);
    };
  }, []);

  // Lend the immersive layer its data + write paths each render (§7.6). `commit`
  // persists once (pointer-up / pill submit) through the ordinary input state so
  // the derive follows and the value round-trips; `preview` fires an immediate,
  // un-persisted derive for the drag's rAF cadence. `preview` reads THIS render's
  // `input` as the base — stable through a drag (nothing is committed until
  // pointer-up), so the dragged key overrides a correct base.
  useEffect(() => {
    const read = (key: string): number | null => {
      const value = derivation?.scope?.[key] ?? input[key];
      return typeof value === "number" ? value : null;
    };
    const { width, height } = dimensionBindings(dimensionRanges, read);
    useManipulation.getState().setBridge({
      width,
      height,
      commit: (key, value) => setInput((prev) => ({ ...prev, [key]: value })),
      preview: (key, value) => requestImmediate({ ...input, [key]: value }),
    });
  }, [dimensionRanges, derivation?.scope, input, requestImmediate]);

  const goTo = (key: string) => {
    const next = flow.findIndex((s) => flowKey(s) === key);
    if (next !== -1) setStepIndex(next);
  };

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-ui-2xl font-semibold tracking-tight">
          {stepLabel(step, t)}
        </h2>
        <span className="text-muted-foreground text-ui-xs whitespace-nowrap">
          {t("stepCounter", { current: String(activeIndex + 1), total: String(flow.length) })}
        </span>
      </div>

      <StepBody
        step={step}
        products={products}
        productIndex={productIndex}
        onSwitchProduct={switchProduct}
        release={product.release}
        steps={steps}
        input={input}
        scope={derivation?.scope}
        result={result}
        drawing={derivation?.drawing}
        priceBlind={priceBlind}
        shareToken={shareToken}
        onValueChange={setValue}
      />

      <div className="flex justify-between pt-1">
        {/* `aria-disabled` + a no-op handler, NOT `disabled`. Pressing Enter on
            the LAST step used to flip `disabled` on the element that currently
            held focus, and a disabled element cannot keep focus — the browser
            dropped it to <body>, so the next Tab restarted at the top of the
            page. The control stays focusable and announces as unavailable. */}
        <Button
          variant="outline"
          size="sm"
          aria-disabled={activeIndex === 0}
          onClick={() => {
            if (activeIndex > 0) setStepIndex(activeIndex - 1);
          }}
        >
          {t("back")}
        </Button>
        <Button
          variant="copper"
          size="sm"
          aria-disabled={activeIndex >= flow.length - 1}
          onClick={() => {
            if (activeIndex < flow.length - 1) setStepIndex(activeIndex + 1);
          }}
        >
          {t("next")}
        </Button>
      </div>
    </>
  );

  return (
    // `h-full`, not a viewport calc. The app shell (components/app-shell, ADR
    // 0118) hands this surface a correctly-sized flex-1 `<main>` slot — full
    // height on desktop/tablet (the nav is a side rail, no top header to
    // subtract) and viewport-minus-top-bar on mobile — so the surface just fills
    // it. When unauthenticated the shell renders children bare and the AuthGuard
    // fallback's own `min-h-screen` takes over; both are full-height, so nothing
    // jumps on auth-resolve. The old hand-coupled `calc(100dvh-3.5rem)` is gone.
    <div className="bg-field flex h-full min-h-0 flex-col">
      {/* Immersive mode (ADR 0116) hides the banded chrome and promotes the scene
          `<main>` to full-bleed. The `<main>` is rendered in BOTH branches (only
          its className changes), so the WebGL canvas never remounts on toggle;
          the rail/form/bars are conditionally rendered because they carry no
          expensive state (the edited config lives in `input` up here). */}
      {!immersive && (
        <ContextBar
          productLabel={product.release.modelId}
          catalogVersion={product.catalogVersion}
          computing={computing}
        />
      )}

      {/* Steps, one band each. Exactly one is in the a11y tree at a time — the
          hidden ones are `display:none`, not visually hidden, so a screen reader
          never meets three copies of the same nav. */}
      {!immersive && (
        <>
          <div className="hidden md:block xl:hidden">
            <StepChips items={railItems} activeKey={activeKey} onSelect={goTo} />
          </div>
          <div className="bg-chrome border-border flex-none border-b px-4 py-2.5 md:hidden">
            <StepProgress
              aria-label={t("configuration")}
              total={flow.length}
              current={activeIndex + 1}
            />
          </div>
        </>
      )}

      {/* One polite announcement per step change. Deliberately a dedicated
          region rather than making the visible heading live: a live heading
          re-announces on every unrelated re-render of its subtree. */}
      <span aria-live="polite" className="sr-only">
        {`${stepLabel(step, t)} — ${t("stepCounter", {
          current: String(activeIndex + 1),
          total: String(flow.length),
        })}`}
      </span>

      <div className={cn("flex min-h-0 flex-1", !immersive && "flex-col-reverse md:flex-row")}>
        {!immersive && (
          <div className="hidden xl:flex">
            <StepsRail items={railItems} activeKey={activeKey} onSelect={goTo} />
          </div>
        )}

        {/* The form column. Below `md` it is the bottom sheet: capped height,
            its own scroll, rounded top, above the scene in reading order because
            the flex parent is `flex-col-reverse`. */}
        {!immersive && (
          <section
            aria-label={stepLabel(step, t)}
            className={
              "bg-chrome border-border flex min-h-0 flex-none flex-col gap-4 overflow-y-auto " +
              "max-h-[55dvh] rounded-t-2xl border-t p-4" +
              "md:max-h-none md:w-[372px] md:rounded-none md:border-r md:border-t-0 md:p-5" +
              "xl:w-[400px]"
            }
          >
            {body}
            {/* Commerce sits in the column at xl+, and in the sticky bar below it. */}
            <div className="mt-auto hidden xl:block">
              <CommercialPanel
                result={result}
                pricing={pricing}
                catalogVersion={product.catalogVersion}
                priceBlind={priceBlind}
                canSeeCost={canSeeCost}
              />
            </div>
          </section>
        )}

        <main
          aria-label={t("scene")}
          className={cn("relative min-h-0 min-w-0 flex-1", immersive && "fixed inset-0 z-50")}
        >
          <SceneColumn
            step={step}
            derivation={derivation}
            computing={computing}
            error={error}
            releaseId={product.release.id}
            webgl={webgl}
            bom={
              result === null ? null : (
                <BomForRole result={result} priceBlind={priceBlind} rounding={pricing.rounding} />
              )
            }
          />
          {immersive && (
            <ImmersiveChrome
              stepLabel={stepLabel(step, t)}
              current={activeIndex + 1}
              total={flow.length}
              onPrev={() => {
                if (activeIndex > 0) setStepIndex(activeIndex - 1);
              }}
              onNext={() => {
                if (activeIndex < flow.length - 1) setStepIndex(activeIndex + 1);
              }}
              result={result}
              canSeeCost={canSeeCost}
              priceBlind={priceBlind}
            />
          )}
        </main>
      </div>

      {/* The tablet/mobile commerce bar (v2-TAB). Absent entirely when the
          session may not see money — absence, not a masked bar (ADR 0056) — and
          in immersive, where the floating chip carries the price instead. */}
      {!immersive && !priceBlind && (
        <div className="xl:hidden">
          <CommerceBar result={result} canSeeCost={canSeeCost} />
        </div>
      )}
    </div>
  );
}

/**
 * The BOM view, picked by role at the call site so the price-blind variant is
 * visible in the JSX rather than hidden behind a boolean the table interprets.
 */
function BomForRole({
  result,
  priceBlind,
  rounding,
}: {
  result: UiResult;
  priceBlind: boolean;
  rounding: ConfiguratorPricing["rounding"];
}) {
  return priceBlind ? (
    <BomTable.PriceBlind result={result} rounding={rounding} className="h-full" />
  ) : (
    <BomTable result={result} rounding={rounding} className="h-full" />
  );
}

type UiResult = NonNullable<ReturnType<typeof useConfiguratorDerive>["derivation"]>["result"];

/**
 * The compact commerce bar for the tablet and mobile bands (frames-v2.jsx:384-391).
 * Price and validity only — the canvas's two CTAs are deliberately absent
 * (ADR 0116: saving already lives on the Souhrn step, and quoting has no
 * destination from an unbound configurator).
 */
function CommerceBar({ result, canSeeCost }: { result: UiResult | null; canSeeCost: boolean }) {
  const t = useTranslations("configurator");
  const locale = useLocale();
  if (result === null) return null;

  // The canvas's tablet bar draws "Cena bez DPH · marže 34 %", and the full
  // `CommercialPanel` only exists at lg+ — so without this an ADMIN on a 900px
  // tablet (the canvas's own on-site band) lost cost, margin and the floor
  // meter entirely, with no way to reach them at that width. The margin rides
  // in the bar's caption for exactly the viewers allowed to see it.
  const margin =
    canSeeCost && result.isValid && result.costMoney !== undefined
      ? marginPct(result.money, result.costMoney)
      : null;

  return (
    <StickyActionBar tone="primary" aria-label={t("priceExVat")}>
      <StickyActionBar.Price>
        <span className="text-ui-xs opacity-80">
          {t("priceExVat")}
          {margin !== null && Number.isFinite(margin)
            ? ` · ${t("marginWithPct", { pct: String(Math.round(margin)) })}`
            : ""}
        </span>
        <span className="font-data text-ui-2xl font-semibold tabular-nums">
          {result.isValid ? formatMoney(result.money.total, locale) : t("priceBlocked")}
        </span>
      </StickyActionBar.Price>
      <StickyActionBar.Note tone={result.isValid ? "muted" : "destructive"}>
        {result.isValid ? t("configValidShort") : t("priceBlockedNote")}
      </StickyActionBar.Note>
    </StickyActionBar>
  );
}

/**
 * The rail's per-step data. `done` and `sub` have no schema behind them
 * (§8.2 asks where they come from), so both are DERIVED rather than invented.
 *
 * **`done` is wizard progress — `index < activeIndex` — and deliberately not
 * parameter completeness.** The obvious-looking rule ("every visible parameter
 * on this step has a value") was tried and is WRONG on the shipped corpus, in
 * both directions at once: `sliding-gate@1` seeds all three `Výbava a práce`
 * parameters from `initialInput`, so that step rendered a completed check before
 * the user had ever opened it, while `Rozměry` and `Konstrukce` each own a
 * parameter that is in the `ui` spec but absent from `initialInput` and carries
 * no `relevance` gate — so they could never read as done no matter what the user
 * did. Every user would have seen the one step nobody visits marked complete and
 * the two steps they actually edit marked incomplete. Progress is monotone,
 * matches what the canvas draws (earlier steps checked, current step ringed),
 * and cannot invert.
 *
 * `sub` is the value echo, taken from the step's OWN first two visible
 * parameters — not the first two that happen to be filled, which made the echo
 * jump to a different pair the moment a later field was touched. Values go
 * through `formatValue`, the same formatter the Souhrn spec sheet uses, so a
 * bool renders "Ano" rather than the raw `true` and an enum renders its authored
 * label rather than its id. Effective values (`scope`) are preferred over raw
 * input so a defaulted parameter still echoes.
 */
function useRailItems(
  flow: BrandStep[],
  activeIndex: number,
  input: ConfigInput,
  scope: Scope | undefined,
  optionSets: OptionSet[],
  t: (key: (typeof STEP_LABEL)[keyof typeof STEP_LABEL] | "yes" | "no") => string,
): RailItem[] {
  return useMemo(
    () =>
      flow.map((step, index) => {
        const defs = step.groups
          .flatMap((g) => g.params)
          .filter((p) => p.visible)
          .map((p) => p.def)
          .slice(0, 2);
        const sub = defs
          .map((def) =>
            formatValue(def, scope?.[def.key] ?? input[def.key], optionSets, t("yes"), t("no")),
          )
          .filter((v) => v !== "—")
          .join(" × ");
        return {
          key: flowKey(step),
          label: stepLabel(step, t),
          ...(sub === "" ? {} : { sub }),
          done: index < activeIndex,
        };
      }),
    [flow, activeIndex, input, scope, optionSets, t],
  );
}

/** The left-column controls for the active brand step. */
function StepBody({
  step,
  products,
  productIndex,
  onSwitchProduct,
  release,
  steps,
  input,
  scope,
  result,
  drawing,
  priceBlind,
  shareToken,
  onValueChange,
}: {
  step: BrandStep;
  products: ConfigurableProduct[];
  productIndex: number;
  onSwitchProduct: (index: number) => void;
  release: ConfigurableProduct["release"];
  steps: ReturnType<typeof resolveUi>;
  input: ConfigInput;
  scope: ReturnType<typeof useConfiguratorDerive>["derivation"] extends null
    ? never
    : Parameters<typeof resolveUi>[1] | undefined;
  result: UiResult | null;
  drawing: NonNullable<ReturnType<typeof useConfiguratorDerive>["derivation"]>["drawing"];
  priceBlind: boolean;
  shareToken: string;
  onValueChange: (key: string, value: Value | undefined) => void;
}) {
  switch (step.kind) {
    case "produkt":
      return (
        <ProductPicker products={products} productIndex={productIndex} onSelect={onSwitchProduct} />
      );
    case "barva":
      return <FinishPicker />;
    case "souhrn":
      return result === null ? null : (
        <Summary
          steps={steps}
          scope={scope}
          input={input}
          result={result}
          optionSets={release.optionSets ?? []}
          priceBlind={priceBlind}
          shareToken={shareToken}
          drawing={drawing}
          releaseId={release.id}
          productLabel={release.modelId}
        />
      );
    // Named rather than `default:`, so adding a fourth SHELL kind is a compile
    // error here (as it already is in `STEP_LABEL`) instead of silently
    // rendering as an empty release step.
    case "release":
      // A release-authored step — its own groups, rendered from data (§8).
      return (
        <ParamGroups
          groups={step.groups}
          optionSets={release.optionSets ?? []}
          input={input}
          scope={scope}
          onValueChange={onValueChange}
        />
      );
  }
}

/** Release-authored parameter groups (§8): legends + fields all from data. */
function ParamGroups({
  groups,
  optionSets,
  input,
  scope,
  onValueChange,
}: {
  groups: ResolvedUiGroup[];
  optionSets: ConfigurableProduct["release"]["optionSets"];
  input: ConfigInput;
  scope: Parameters<typeof resolveUi>[1] | undefined;
  onValueChange: (key: string, value: Value | undefined) => void;
}) {
  const t = useTranslations("configurator");
  const visibleGroups = groups
    .map((g) => ({ ...g, visible: g.params.filter((p) => p.visible) }))
    .filter((g) => g.visible.length > 0);

  if (visibleGroups.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("stepNoParams")}</p>;
  }

  return (
    <Panel className="flex flex-col gap-5 text-sm" elevation="flat">
      {visibleGroups.map((group, i) => (
        // Index-composed key. Since ADR 0115 each step renders only its OWN
        // groups, so a collision needs a release to repeat a group id within one
        // step — publish validation does not forbid it, so keep the index.
        <fieldset key={`${group.id}-${i}`} className="flex flex-col gap-3">
          {group.label !== undefined && (
            <legend className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
              {group.label}
            </legend>
          )}
          {group.visible.map(({ def }) => (
            <ParamField
              key={def.key}
              def={def}
              optionSets={optionSets ?? []}
              value={input[def.key]}
              effective={scope?.[def.key]}
              onChange={(value) => onValueChange(def.key, value)}
            />
          ))}
        </fieldset>
      ))}
    </Panel>
  );
}

/** The Produkt step — pick the product line (the Bombardier model carousel). */
function ProductPicker({
  products,
  productIndex,
  onSelect,
}: {
  products: ConfigurableProduct[];
  productIndex: number;
  onSelect: (index: number) => void;
}) {
  const t = useTranslations("configurator");
  return (
    <Panel className="flex flex-col gap-3 text-sm">
      <h2 className="font-semibold">{t("product")}</h2>
      <div className="flex flex-col gap-2">
        {products.map((p, i) => {
          const active = i === productIndex;
          return (
            <button
              key={p.release.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(i)}
              className={
                active
                  ? "border-copper bg-chrome shadow-soft rounded-xl border px-4 py-3 text-left"
                  : "border-border bg-chrome-subtle hover:border-copper/60 rounded-xl border px-4 py-3 text-left"
              }
            >
              <span className="font-medium">{p.release.modelId}</span>
              <span className="text-muted-foreground"> · v{p.release.version}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
