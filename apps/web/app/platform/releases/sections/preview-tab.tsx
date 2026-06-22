"use client";

import { useMemo } from "react";

import type { ConfigInput, MoneyTotals } from "@repo/engine";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { resolveUi, type ProductModelRelease, type Value } from "@repo/model";

import { formatMoney } from "../../../../lib/format-money";
import { ParamField } from "../../../configurator/param-field";
import { ResultsPanel } from "../../../configurator/results-panel";
import { type ReleasePreview } from "../lib/use-release-preview";

/**
 * Live engine preview (ADR 0068 Phase 4) — the dock tab that derives the
 * in-progress release on a sample input so the author SEES it produce: the
 * generated wizard (resolveUi off the release itself), the BOM/price, and the
 * typed Issues (I5 — an invalid config shows its problems, never a silent BOM).
 * Presentational: the editor owns the derive (`useReleasePreview`, so the live
 * scope also feeds the workbench ExprFields' `=value`) and passes it in. The
 * wizard + BOM render with the configurator's own primitives (no second design);
 * money degrades honestly — a price-blind session or no active price table shows
 * a notice, never a confident zero.
 */
export function PreviewTab({
  release,
  preview,
  input,
  onInputChange,
  priceBlind,
}: {
  release: ProductModelRelease | null;
  preview: ReleasePreview;
  input: ConfigInput;
  onInputChange: (next: ConfigInput) => void;
  priceBlind: boolean;
}) {
  const t = useTranslations("releaseEditor");

  // Resolve the wizard off the release itself; `scope` (when valid) feeds the
  // `effective` (default-applied) values + relevance, else the raw input.
  const params = useMemo(() => {
    if (release === null) return [];
    return resolveUi(release, preview.scope ?? input)
      .flatMap((step) => step.groups.flatMap((group) => group.params))
      .filter((param) => param.visible);
  }, [release, preview.scope, input]);
  const optionSets = release?.optionSets ?? [];

  const setValue = (key: string, value: Value | undefined) => {
    const next = { ...input };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onInputChange(next);
  };

  if (preview.status === "no-catalog") return <Notice text={t("previewNoCatalog")} />;
  if (preview.status === "no-prices") return <Notice text={t("previewNoPrices")} />;
  if (preview.status === "no-release") return <Notice text={t("previewNoRelease")} />;

  return (
    <div className="flex flex-col gap-3">
      {params.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("previewInputs")}</h3>
          {params.map((param) => (
            <ParamField
              key={param.def.key}
              def={param.def}
              optionSets={optionSets}
              value={input[param.def.key]}
              effective={preview.scope?.[param.def.key]}
              onChange={(value) => setValue(param.def.key, value)}
            />
          ))}
        </section>
      )}

      {preview.status === "computing" && (
        <p className="text-muted-foreground text-xs">{t("previewComputing")}</p>
      )}
      {preview.status === "error" && (
        <Notice text={t("previewError", { message: preview.message ?? "" })} />
      )}

      {preview.result && <ResultsPanel result={preview.result} priceBlind={priceBlind} />}

      {preview.result?.isValid && preview.result.costMoney && !priceBlind && (
        <CostMargin money={preview.result.money} costMoney={preview.result.costMoney} />
      )}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
      {text}
    </p>
  );
}

/** Cost-of-goods + real margin (ADR 0059) — shown only when the price table
 *  carries a cost layer and the session may see money. */
function CostMargin({ money, costMoney }: { money: MoneyTotals; costMoney: MoneyTotals }) {
  const t = useTranslations("releaseEditor");
  const locale = useLocale();
  const price = Number(money.total);
  const cost = Number(costMoney.total);
  const marginPct = price > 0 ? ((price - cost) / price) * 100 : 0;
  return (
    <div className="border-border rounded-md border p-4 text-sm">
      <dl className="grid grid-cols-2 gap-y-1">
        <dt className="text-muted-foreground">{t("previewCost")}</dt>
        <dd className="text-right tabular-nums">{formatMoney(costMoney.total, locale)}</dd>
        <dt className="text-muted-foreground">{t("previewMargin")}</dt>
        <dd className="text-right tabular-nums">{marginPct.toFixed(1)} %</dd>
      </dl>
    </div>
  );
}
