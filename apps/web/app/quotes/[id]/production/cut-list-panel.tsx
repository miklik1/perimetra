"use client";

import { useTranslations } from "@repo/i18n/web";
import { Panel } from "@repo/ui";
import { type QuoteProduction } from "@repo/validators";

/**
 * The cutting instructions (CAR-24): per-component cut lines (length × count,
 * mitre angles when present) plus the FFD nesting plan into stock bars when the
 * catalog declares a stock length (`@repo/renderers`' `buildCutList`, CORE_SPEC
 * §5). Pure presentation over `QuoteProduction["cutList"]` — no geometry here.
 */
function formatAngle(arcMin: number | undefined): string {
  return arcMin === undefined ? "90°" : `${(arcMin / 60).toFixed(1)}°`;
}

export function CutListPanel({
  cutList,
  kerfMm,
}: {
  cutList: QuoteProduction["cutList"];
  kerfMm: number;
}) {
  const t = useTranslations("quotes");

  if (cutList.components.length === 0) {
    return (
      <Panel>
        <h2 className="mb-2 font-semibold">{t("production.cutList")}</h2>
        <p className="text-muted-foreground text-sm">{t("production.cutListEmpty")}</p>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col gap-5">
      <h2 className="font-semibold">
        {t("production.cutList")}
        {kerfMm > 0 && (
          <span className="text-muted-foreground ml-2 text-xs font-normal">kerf {kerfMm} mm</span>
        )}
      </h2>
      {cutList.components.map((component) => (
        <div key={component.componentCode} className="flex flex-col gap-2">
          <h3 className="font-data text-sm font-medium">
            {component.name}
            <span className="text-muted-foreground ml-2 text-xs">{component.componentCode}</span>
          </h3>
          <table className="font-data w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs uppercase">
                <th className="py-1 font-medium">{t("production.colLength")}</th>
                <th className="py-1 text-right font-medium">{t("production.colCount")}</th>
              </tr>
            </thead>
            <tbody>
              {component.lines.map((line, index) => (
                <tr key={`${component.componentCode}-${index}`} className="border-border border-t">
                  <td className="py-1 tabular-nums">
                    {Math.round(line.lengthMm)} mm
                    {line.cutArcMin && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        {formatAngle(line.cutArcMin.left)} / {formatAngle(line.cutArcMin.right)}
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums">{line.count}×</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-border border-t font-medium">
                <td className="py-1">{t("production.colTotalLength")}</td>
                <td className="py-1 text-right tabular-nums">
                  {Math.round(component.totalLengthMm)} mm
                </td>
              </tr>
            </tfoot>
          </table>

          {component.nesting && (
            <div className="text-xs">
              <p className="text-muted-foreground mb-1">
                {t("production.nesting")} — {component.nesting.stockLengthMm} mm
              </p>
              <ul className="flex flex-col gap-0.5">
                {component.nesting.bars.map((bar) => (
                  <li key={bar.index} className="font-data tabular-nums">
                    {t("production.bar", { index: String(bar.index + 1) })}:{" "}
                    {bar.cuts.map((c) => Math.round(c.lengthMm)).join(" + ")}
                    <span className="text-muted-foreground">
                      {" "}
                      · {t("production.offcut")} {Math.round(bar.offcutMm)} mm
                    </span>
                  </li>
                ))}
              </ul>
              {component.nesting.oversize.length > 0 && (
                <p className="text-destructive mt-1">
                  {t("production.oversize")}:{" "}
                  {component.nesting.oversize.map((o) => Math.round(o.lengthMm)).join(", ")} mm
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}
