"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AuthGuard } from "@repo/auth/react";
import type { ConfigInput, PriceTable } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import { resolveUi, type Catalog, type ResolvedUiGroup, type Value } from "@repo/model";
import { Button, DisplayLabel, Panel, StepNav } from "@repo/ui";

import { usePriceBlind } from "../../lib/use-role";
import { decodeConfig, encodeConfig } from "./config-hash";
import { deriveForUi, type UiDerivation } from "./derive";
import { SitePlanSvg, WorkshopDrawingSvg } from "./drawing-svg";
import { FinishPicker } from "./finish-picker";
import { ParamField } from "./param-field";
import type { CatalogBundle, ConfigurableProduct } from "./products";
import { SceneViewport } from "./scene/scene-viewport";
import { webglAvailable } from "./scene/webgl";
import { Summary } from "./summary";
import { buildFlow, type BrandStep, type BrandStepKind } from "./wizard-flow";

/**
 * The generated configurator (CORE_SPEC §8) wearing the Bombardier-derived brand
 * (ADR 0072) and the 5-step UX grammar (ADR 0077): a fixed CZ spine — Produkt ·
 * Lokalita · Konfigurace · Barva a povrch · Souhrn — over the release's OWN
 * authored UiSpec (so labels/options/groups stay release data, §8). The engine
 * runs in the browser (pure, I1); hybrid coverage pairs the live R3F hero with
 * the `drawing2d.ts` SVG plan (Lokalita) + elevation (Summary) + WebGL fallback.
 *
 * Catalog/releases/active price table are served by the api (ADR 0060): the RSC
 * fetches the bundle and prop-passes it here.
 */

/** Brand step → its CZ pill label key (literal union for the typed `t`). */
const STEP_LABEL = {
  produkt: "stepProdukt",
  lokalita: "stepLokalita",
  konfigurace: "stepKonfigurace",
  barva: "stepBarva",
  souhrn: "stepSouhrn",
} as const satisfies Record<BrandStepKind, string>;

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
      ) : bundle.prices === null ? (
        notice(t("noPrices"))
      ) : (
        <ConfiguratorInner
          products={bundle.products}
          catalogs={bundle.catalogs}
          prices={bundle.prices}
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
  prices,
}: {
  products: ConfigurableProduct[];
  catalogs: ReadonlyMap<string, Catalog>;
  prices: PriceTable;
}) {
  const t = useTranslations("configurator");
  const priceBlind = usePriceBlind();

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

  const product = products[productIndex]!;
  const derivation = useMemo(
    () => deriveForUi(product, input, prices, catalogs),
    [product, input, prices, catalogs],
  );
  const steps = useMemo(
    () => resolveUi(product.release, derivation.scope ?? input),
    [product.release, derivation.scope, input],
  );
  const flow = useMemo(() => buildFlow(steps), [steps]);
  const step = flow[stepIndex] ?? flow[0]!;
  const shareToken = useMemo(
    () => encodeConfig({ releaseId: product.release.id, input }),
    [product.release.id, input],
  );

  const switchProduct = (index: number) => {
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

  return (
    <Field>
      <header className="border-border/60 bg-field/80 sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b px-6 py-3 backdrop-blur">
        <span className="text-foreground font-display text-lg font-semibold tracking-tight">
          Perimetra
        </span>
        <div className="flex-1">
          <StepNav
            aria-label={t("title")}
            steps={flow.map((s) => ({ id: s.kind, label: t(STEP_LABEL[s.kind]) }))}
            activeIndex={stepIndex}
            onSelect={setStepIndex}
          />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl items-start gap-8 p-6 lg:grid-cols-[minmax(340px,38%)_1fr]">
        <section className="flex flex-col gap-5">
          <DisplayLabel className="text-3xl sm:text-4xl">{t(STEP_LABEL[step.kind])}</DisplayLabel>

          <StepBody
            step={step}
            products={products}
            productIndex={productIndex}
            onSwitchProduct={switchProduct}
            release={product.release}
            steps={steps}
            input={input}
            scope={derivation.scope}
            result={derivation.result}
            drawing={derivation.drawing}
            priceBlind={priceBlind}
            shareToken={shareToken}
            onValueChange={setValue}
          />

          <div className="flex justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex(stepIndex - 1)}
            >
              {t("back")}
            </Button>
            <Button
              variant="copper"
              size="sm"
              disabled={stepIndex >= flow.length - 1}
              onClick={() => setStepIndex(stepIndex + 1)}
            >
              {t("next")}
            </Button>
          </div>
        </section>

        <section className="lg:sticky lg:top-24">
          <div className="h-[440px] lg:h-[calc(100vh-9rem)]">
            <Hero
              step={step}
              derivation={derivation}
              releaseId={product.release.id}
              webgl={webgl}
            />
          </div>
        </section>
      </main>
    </Field>
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
  scope: UiDerivation["scope"];
  result: UiDerivation["result"];
  drawing: UiDerivation["drawing"];
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
      return (
        <Summary
          steps={steps}
          scope={scope}
          input={input}
          result={result}
          optionSets={release.optionSets ?? []}
          priceBlind={priceBlind}
          shareToken={shareToken}
          drawing={drawing}
        />
      );
    default:
      // lokalita / konfigurace — the release's authored groups (§8).
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
  scope: UiDerivation["scope"];
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
        // Index-composed key: Konfigurace flattens groups from several authored
        // steps, so a release reusing a group id across steps can't collide.
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

/** The hero: persistent live R3F across the 3D steps (the camera animates between
 *  named poses), the SVG plan on Lokalita, the SVG elevation as the WebGL-down
 *  fallback (technique 10). */
function Hero({
  step,
  derivation,
  releaseId,
  webgl,
}: {
  step: BrandStep;
  derivation: UiDerivation;
  releaseId: string;
  webgl: boolean;
}) {
  const t = useTranslations("configurator");

  if (step.kind === "lokalita") {
    return derivation.plan !== undefined ? (
      <Panel elevation="raised" padded={false} className="h-full overflow-hidden p-4">
        <SitePlanSvg plan={derivation.plan} className="h-full w-full" />
      </Panel>
    ) : (
      <ViewportNote message={t("sceneInvalid")} />
    );
  }

  if (webgl && derivation.scene !== undefined) {
    return <SceneViewport key={releaseId} scene={derivation.scene} view={step.view} />;
  }

  // WebGL unavailable (or invalid scene) → the pure technical elevation.
  return derivation.drawing !== undefined ? (
    <Panel elevation="raised" className="h-full overflow-hidden">
      <WorkshopDrawingSvg drawing={derivation.drawing} className="h-full w-full" />
    </Panel>
  ) : (
    <ViewportNote message={t("sceneInvalid")} />
  );
}

function ViewportNote({ message }: { message: string }) {
  return (
    <div className="bg-field-raised text-muted-foreground shadow-soft flex h-full items-center justify-center rounded-2xl text-sm">
      {message}
    </div>
  );
}
