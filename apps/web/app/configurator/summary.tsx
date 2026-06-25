"use client";

import { useState } from "react";

import type { DerivationResult } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import type { OptionSet, ResolvedUiStep, Scope, Value } from "@repo/model";
import type { WorkshopDrawing } from "@repo/renderers";
import { Button, Panel } from "@repo/ui";

import { DeviationPanel } from "./deviation-panel";
import { WorkshopDrawingSvg } from "./drawing-svg";
import { ResultsPanel } from "./results-panel";
import { finishById, useFinish } from "./scene/finish";

/**
 * The Souhrn / Poptávka step (ADR 0077) — the Bombardier Summary: the
 * configuration IS the spec sheet + the lead capture. The spec is read from the
 * release-resolved params (§8 — labels/options from data) + the chosen finish;
 * the price/BOM reuse `ResultsPanel` and deviations reuse `DeviationPanel` (no
 * second design). "Sdílet" copies a reproducible config-hash link (the I3 tie);
 * the lead form captures contact against the spec.
 *
 * The lead SUBMIT is a presentation confirmation for v1 — the configurator
 * preview is not yet a persisted project, so wiring it to the projects/quotes
 * issue path is a follow-on; the share link already makes the config durable.
 */
function formatValue(
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
}: {
  steps: ResolvedUiStep[];
  scope: Scope | undefined;
  input: Record<string, Value | undefined>;
  result: DerivationResult;
  optionSets: OptionSet[];
  priceBlind: boolean;
  shareToken: string;
  drawing: WorkshopDrawing | undefined;
}) {
  const t = useTranslations("configurator");
  const finish = useFinish((s) => finishById(s.finishId));
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [lead, setLead] = useState({ name: "", email: "", phone: "", note: "" });

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

      <Panel className="flex flex-col gap-3 text-sm">
        <h2 className="font-semibold">{t("leadTitle")}</h2>
        {submitted ? (
          <p className="text-muted-foreground">{t("leadThanks")}</p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
          >
            <input
              required
              type="text"
              placeholder={t("leadName")}
              value={lead.name}
              onChange={(e) => setLead((l) => ({ ...l, name: e.target.value }))}
              className="border-border bg-chrome-subtle focus-visible:ring-copper w-full rounded-lg border px-3 py-2 outline-none focus-visible:ring-2"
            />
            <input
              required
              type="email"
              placeholder={t("leadEmail")}
              value={lead.email}
              onChange={(e) => setLead((l) => ({ ...l, email: e.target.value }))}
              className="border-border bg-chrome-subtle focus-visible:ring-copper w-full rounded-lg border px-3 py-2 outline-none focus-visible:ring-2"
            />
            <input
              type="tel"
              placeholder={t("leadPhone")}
              value={lead.phone}
              onChange={(e) => setLead((l) => ({ ...l, phone: e.target.value }))}
              className="border-border bg-chrome-subtle focus-visible:ring-copper w-full rounded-lg border px-3 py-2 outline-none focus-visible:ring-2"
            />
            <textarea
              placeholder={t("leadNote")}
              value={lead.note}
              onChange={(e) => setLead((l) => ({ ...l, note: e.target.value }))}
              rows={2}
              className="border-border bg-chrome-subtle focus-visible:ring-copper w-full rounded-lg border px-3 py-2 outline-none focus-visible:ring-2"
            />
            <Button type="submit" variant="copper" size="sm" className="self-start">
              {t("leadSubmit")}
            </Button>
          </form>
        )}
      </Panel>
    </div>
  );
}
