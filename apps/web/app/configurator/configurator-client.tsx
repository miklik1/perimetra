"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { AuthGuard } from "@repo/auth/react";
import type { ConfigInput, PriceTable } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import { resolveUi, type Catalog, type Value } from "@repo/model";
import { Panel } from "@repo/ui";

import { usePriceBlind } from "../../lib/use-role";
import { deriveForUi } from "./derive";
import { FinishPicker } from "./finish-picker";
import type { CatalogBundle, ConfigurableProduct } from "./products";
import { ResultsPanel } from "./results-panel";
import { SceneViewport } from "./scene/scene-viewport";
import { Wizard } from "./wizard";

/**
 * The generated configurator (CORE_SPEC §8 / step 6 slice 1): pick a release,
 * edit through the wizard the release itself describes, watch the engine derive
 * BOM/price/3D live in the browser (the engine is pure — I1 — so the client IS a
 * valid host). The catalog/releases/active price table are SERVED BY THE API (ADR
 * 0060): the RSC fetches the bundle and prop-passes it here.
 *
 * The surface wears the Perimetra brand system (ADR 0072): a warm-grey field,
 * flat-matte chrome panels, the copper accent. The premium hero layout + the
 * 5-step CZ flow land in the Part-B slice; here the brand chrome dresses the
 * existing generated structure.
 *
 * Outer shell: AuthGuard + the bundle's empty states. The engine needs a price
 * table to derive, so a price-blind/workshop session (no `prices`, ADR 0056) or
 * an unpublished catalog renders a notice rather than the wizard.
 */
export function ConfiguratorClient({ bundle }: { bundle: CatalogBundle | null }) {
  const router = useRouter();
  const t = useTranslations("configurator");

  const notice = (message: string) => (
    <Field>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
        <h1 className="text-foreground text-3xl font-light tracking-tight">{t("title")}</h1>
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

/** The stateful configurator, rendered once the bundle has products + catalogs +
 *  a price table (the engine's required inputs). */
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
  const productSelectId = useId();

  const priceBlind = usePriceBlind();

  const [productIndex, setProductIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [input, setInput] = useState<ConfigInput>(() => ({ ...products[0]!.initialInput }));

  const product = products[productIndex]!;
  const derivation = useMemo(
    () => deriveForUi(product, input, prices, catalogs),
    [product, input, prices, catalogs],
  );
  const steps = useMemo(
    () => resolveUi(product.release, derivation.scope ?? input),
    [product.release, derivation.scope, input],
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
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-foreground text-3xl font-light tracking-tight">{t("title")}</h1>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor={productSelectId} className="text-muted-foreground">
              {t("product")}
            </label>
            <select
              id={productSelectId}
              value={productIndex}
              onChange={(e) => switchProduct(Number(e.target.value))}
              className="border-border bg-chrome shadow-soft focus-visible:ring-ring rounded-full border px-4 py-1.5 outline-none focus-visible:ring-2"
            >
              {products.map((p, i) => (
                <option key={p.release.id} value={i}>
                  {p.release.modelId} (v{p.release.version})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[400px_1fr]">
          <Wizard
            release={product.release}
            steps={steps}
            stepIndex={stepIndex}
            input={input}
            scope={derivation.scope}
            onStepChange={setStepIndex}
            onValueChange={setValue}
          />
          <div key={product.release.id} className="flex flex-col gap-6">
            <SceneViewport scene={derivation.scene} />
            <FinishPicker />
            <ResultsPanel result={derivation.result} priceBlind={priceBlind} />
          </div>
        </div>
      </main>
    </Field>
  );
}
