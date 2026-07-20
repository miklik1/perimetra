"use client";

import { useState } from "react";

import type { ConfigInput, DerivationResult } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import type { OptionSet, ResolvedUiStep, Scope, Value } from "@repo/model";
import type { WorkshopDrawing } from "@repo/renderers";
import { Button, Panel } from "@repo/ui";

import { DeviationPanel } from "./deviation-panel";
import { WorkshopDrawingSvg } from "./drawing-svg";
import { ResultsPanel } from "./results-panel";
import { SaveToProjectPanel } from "./save-to-project-panel";
import { finishById, useFinish } from "./scene/finish";

/**
 * The Souhrn step (ADR 0077) — the Bombardier Summary: the configuration IS
 * the spec sheet. The spec is read from the release-resolved params (§8 —
 * labels/options from data) + the chosen finish; the price/BOM reuse
 * `ResultsPanel` and deviations reuse `DeviationPanel` (no second design).
 * "Sdílet" copies a reproducible config-hash link (the I3 tie).
 *
 * The step's primary action — and the wizard's real ending — is the
 * `SaveToProjectPanel` below the spec sheet (CAR-13): it composes the
 * projects create/GET-site/PUT-site contracts to land the configuration on
 * `/site/:projectId`, ready to price/issue there. CAR-22 retired the fake
 * client-state-only Poptávka lead form that used to sit here (a `setSubmitted`
 * "thanks" that persisted nothing). Anonymous, PUBLIC lead capture (no signed-
 * in user) is explicitly NOT this step's job — board-time scope decision: it
 * belongs to the ADR 0048 deep-link receiving side (M6), where an anonymous
 * visitor actually exists.
 */
export function formatValue(
  def: { type: string; domain?: { kind: string; values?: string[] } },
  value: Value | undefined,
  optionSets: OptionSet[],
  yes: string,
  no: string,
): string {
  if (value === undefined || value === "") return "—";
  if (def.type === "bool") return value ? yes : no;
  const optionSet = optionSets.find((s) => s.options.some((o) => o.id === value));
  const option = optionSet?.options.find((o) => o.id === value);
  if (option !== undefined) return option.label ?? option.id;
  if (def.type === "length_mm") return `${String(value)} mm`;
  return String(value);
}

export function Summary({
  steps,
  scope,
  input,
  result,
  optionSets,
  priceBlind,
  shareToken,
  drawing,
  releaseId,
  productLabel,
}: {
  steps: ResolvedUiStep[];
  scope: Scope | undefined;
  input: ConfigInput;
  result: DerivationResult;
  optionSets: OptionSet[];
  priceBlind: boolean;
  shareToken: string;
  drawing: WorkshopDrawing | undefined;
  /** The active release id (e.g. `sliding-gate@1`) — passed through, opaque,
   *  to the save-to-project hand-off (CAR-13). */
  releaseId: string;
  /** A human label for the default new-project name (the release's model id). */
  productLabel: string;
}) {
  const t = useTranslations("configurator");
  const finish = useFinish((s) => finishById(s.finishId));
  const [copied, setCopied] = useState(false);

  const specRows = steps
    .flatMap((s) => s.groups)
    .flatMap((g) => g.params)
    .filter((p) => p.visible)
    .map((p) => ({
      key: p.def.key,
      label: p.def.label ?? p.def.key,
      value: formatValue(
        p.def,
        scope?.[p.def.key] ?? input[p.def.key],
        optionSets,
        t("yes"),
        t("no"),
      ),
    }));

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?c=${shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (e.g. insecure context) — fall back to the address bar.
      window.history.replaceState(null, "", `?c=${shareToken}`);
    }
    setCopied(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-col gap-3 text-sm">
        <h2 className="font-semibold">{t("specSheet")}</h2>
        <dl className="font-data grid grid-cols-2 gap-x-4 gap-y-1">
          {specRows.map((row) => (
            <div key={row.key} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="text-right tabular-nums">{row.value}</dd>
            </div>
          ))}
          <div className="contents">
            <dt className="text-muted-foreground">{t("finishTitle")}</dt>
            <dd className="text-right">
              {finish.label}
              {finish.ral !== undefined && ` · ${finish.ral}`}
            </dd>
          </div>
        </dl>
        <div className="flex items-center gap-3 pt-1">
          <Button variant="outline" size="sm" onClick={() => void share()}>
            {copied ? t("shareCopied") : t("share")}
          </Button>
        </div>
      </Panel>

      {drawing !== undefined && (
        <Panel className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{t("elevation")}</h2>
          <WorkshopDrawingSvg drawing={drawing} className="h-48 w-full" />
        </Panel>
      )}

      <DeviationPanel result={result} />
      <ResultsPanel result={result} priceBlind={priceBlind} />

      <SaveToProjectPanel releaseId={releaseId} productLabel={productLabel} input={input} />
    </div>
  );
}
