"use client";

import type { SiteResult } from "@repo/engine";
import { useLocale, useTranslations } from "@repo/i18n/web";

import { formatMoney } from "../../lib/format-money";
import { IssueList } from "./issue-list";

/**
 * The aggregate site result (CORE_SPEC §5/§6): the one BOM every connected
 * instance rolls up into — shared elements counted once (I6), money crossing
 * the I10 decimal-string boundary, and every site-level issue surfaced (I5). An
 * invalid site shows its typed problems and no totals, never a partial BOM.
 *
 * `priceBlind` (ADR 0056) is the FE mirror of the server price-blind rule: the
 * `workshop` role sees geometry/specs (BOM items + quantities) but no money —
 * the totals card and the price column drop out. Defence in depth; the server
 * is the authority (a workshop client never receives the prices over the wire).
 */
export function SiteResultsPanel({
  result,
  priceBlind = false,
}: {
  result: SiteResult;
  priceBlind?: boolean;
}) {
  const t = useTranslations("site");
  const locale = useLocale();
  const money = (decimal: string) => formatMoney(decimal, locale);

  const categories = [
    ["totalMaterial", result.money.material],
    ["totalAccessory", result.money.accessory],
    ["totalManufacturing", result.money.manufacturing],
    ["totalInstallation", result.money.installation],
  ] as const;

  return (
    <section className="flex flex-col gap-4 text-sm">
      {result.issues.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-border p-4">
          <h2 className="font-semibold">{t("issues")}</h2>
          <IssueList issues={result.issues} />
        </div>
      )}

      {result.isValid && (
        <>
          {!priceBlind && (
            <div className="rounded-md border border-border p-4">
              <h2 className="mb-2 font-semibold">{t("totals")}</h2>
              <dl className="grid grid-cols-2 gap-y-1 font-data">
                {categories.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{t(key)}</dt>
                    <dd className="text-right tabular-nums">{money(value)}</dd>
                  </div>
                ))}
                <div className="col-span-2 mt-1 border-t border-border pt-1" />
                <dt className="font-semibold">{t("totalTotal")}</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {money(result.money.total)}
                </dd>
              </dl>
              {result.sharing.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("sharingCount", { count: String(result.sharing.length) })}
                </p>
              )}
            </div>
          )}

          <div className="rounded-md border border-border p-4">
            <h2 className="mb-2 font-semibold">{t("bom")}</h2>
            <table className="w-full text-left font-data">
              <thead>
                <tr className="text-xs text-muted-foreground uppercase">
                  <th className="py-1 font-medium">{t("bomItem")}</th>
                  <th className="py-1 text-right font-medium">{t("bomQuantity")}</th>
                  {!priceBlind && <th className="py-1 text-right font-medium">{t("bomPrice")}</th>}
                </tr>
              </thead>
              <tbody>
                {result.bom.map((line) => (
                  <tr
                    key={`${line.componentCode}|${line.unit}|${line.category}`}
                    className="border-t border-border"
                  >
                    <td className="py-1">
                      {line.name}
                      {line.sources.length > 1 && (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          ×{line.sources.length}
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {line.quantity} {line.unit}
                    </td>
                    {!priceBlind && (
                      <td className="py-1 text-right tabular-nums">
                        {money(line.totalPriceMoney)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
