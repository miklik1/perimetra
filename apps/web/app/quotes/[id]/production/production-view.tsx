"use client";

import { useTranslations } from "@repo/i18n/web";
import { DisplayLabel, Panel } from "@repo/ui";
import { type QuoteProduction } from "@repo/validators";

import { SitePlanSvg, WorkshopDrawingSvg } from "../../../configurator/drawing-svg";
import { QuoteStatusBadge } from "../../quote-status";
import { CutListPanel } from "./cut-list-panel";

/**
 * The workshop build sheet (CAR-24, ADR 0101): document header, per-instance 2D
 * drawings (elevation + the shared site plan), the cut list, and BOM
 * quantities — every field off the ROLE-INDEPENDENT `QuoteProduction` (never a
 * price/cost/margin field, by construction of the schema itself). Reuses the
 * configurator's own `WorkshopDrawingSvg`/`SitePlanSvg` (no second drawing
 * implementation, ADR 0077) and the shared `QuoteStatusBadge`.
 */
export function ProductionView({ production }: { production: QuoteProduction }) {
  const t = useTranslations("quotes");
  const releaseLabel = new Map(production.instances.map((i) => [i.instanceId, i.releaseId]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <DisplayLabel as="h1" className="font-data">
          {production.documentNumber}
        </DisplayLabel>
        <QuoteStatusBadge status={production.status} />
      </div>

      {production.drawings.site.instances.length > 0 && (
        <Panel className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{t("production.sitePlan")}</h2>
          <SitePlanSvg plan={production.drawings.site} className="h-64 w-full" />
        </Panel>
      )}

      {production.instances.map(({ instanceId, releaseId }) => {
        const drawing = production.drawings.instances[instanceId];
        if (!drawing) return null;
        return (
          <Panel key={instanceId} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">
              {t("production.instance")}: {instanceId}
              <span className="text-muted-foreground font-data ml-2 text-xs">
                {releaseLabel.get(instanceId) ?? releaseId}
              </span>
            </h2>
            <h3 className="text-muted-foreground text-xs uppercase">{t("production.elevation")}</h3>
            <WorkshopDrawingSvg drawing={drawing} className="h-56 w-full" />
          </Panel>
        );
      })}

      <CutListPanel cutList={production.cutList} kerfMm={production.cutOptions.kerfMm} />

      <Panel>
        <h2 className="mb-2 font-semibold">{t("production.bom")}</h2>
        <table className="font-data w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs uppercase">
              <th className="py-1 font-medium">{t("production.bomItem")}</th>
              <th className="py-1 text-right font-medium">{t("production.bomQuantity")}</th>
            </tr>
          </thead>
          <tbody>
            {production.bom.map((line) => (
              <tr key={line.componentCode} className="border-border border-t">
                <td className="py-1">
                  {line.name}
                  <span className="text-muted-foreground ml-2 text-xs">{line.componentCode}</span>
                </td>
                <td className="py-1 text-right tabular-nums">
                  {line.quantity} {line.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
