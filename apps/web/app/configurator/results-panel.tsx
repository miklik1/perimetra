"use client";

import type { DerivationResult, Issue } from "@repo/engine";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { cn, Panel } from "@repo/ui";

import { formatMoney } from "../../lib/format-money";

/**
 * Live derivation output: category totals (off the I10 decimal-string money
 * boundary), the BOM, and every surfaced Issue (I5 — an invalid config shows
 * its typed problems, never a silent zero). Issue texts render as
 * `key + params` for now; the issue-key i18n catalog is a step-6 follow-up
 * (ConstraintDef.key doubles as the message key by design).
 *
 * `priceBlind` (ADR 0056) mirrors the server price-blind rule for the `workshop`
 * role: BOM items + quantities stay, all money (totals card + price column) is
 * hidden. Defence in depth — the server is the price authority.
 */
export function ResultsPanel({
  result,
  priceBlind = false,
}: {
  result: DerivationResult;
  priceBlind?: boolean;
}) {
  const t = useTranslations("configurator");
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
        <Panel className="flex flex-col gap-1">
          <h2 className="font-semibold">{t("issues")}</h2>
          <ul className="flex flex-col gap-1">
            {result.issues.map((issue, i) => (
              <IssueLine key={`${issue.key}-${i}`} issue={issue} />
            ))}
          </ul>
        </Panel>
      )}

      {result.isValid && (
        <>
          {!priceBlind && (
            <Panel>
              <h2 className="mb-2 font-semibold">{t("totals")}</h2>
              <dl className="font-data grid grid-cols-2 gap-y-1">
                {categories.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{t(key)}</dt>
                    <dd className="text-right tabular-nums">{money(value)}</dd>
                  </div>
                ))}
                <div className="border-border col-span-2 mt-1 border-t pt-1" />
                <dt className="font-semibold">{t("totalTotal")}</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {money(result.money.total)}
                </dd>
              </dl>
            </Panel>
          )}

          <Panel>
            <h2 className="mb-2 font-semibold">{t("bom")}</h2>
            <table className="font-data w-full text-left">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase">
                  <th className="py-1 font-medium">{t("bomItem")}</th>
                  <th className="py-1 text-right font-medium">{t("bomQuantity")}</th>
                  {!priceBlind && <th className="py-1 text-right font-medium">{t("bomPrice")}</th>}
                </tr>
              </thead>
              <tbody>
                {result.parts.map((part) => (
                  <tr key={part.path} className="border-border border-t">
                    <td className="py-1">{part.name}</td>
                    <td className="py-1 text-right tabular-nums">
                      {part.quantity} {part.unit}
                    </td>
                    {!priceBlind && (
                      <td className="py-1 text-right tabular-nums">
                        {part.totalPrice !== undefined ? money(String(part.totalPrice)) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </section>
  );
}

function IssueLine({ issue }: { issue: Issue }) {
  const t = useTranslations("configurator");
  const params =
    issue.params === undefined
      ? ""
      : Object.entries(issue.params)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(", ");
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={cn(
          "font-data rounded px-1.5 text-[10px] font-semibold uppercase",
          issue.severity === "error"
            ? "bg-destructive/15 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        {issue.severity === "error" ? t("issueError") : t("issueWarn")}
      </span>
      <span>
        <code className="text-xs">{issue.key}</code>
        {params && <span className="text-muted-foreground text-xs"> ({params})</span>}
      </span>
    </li>
  );
}
