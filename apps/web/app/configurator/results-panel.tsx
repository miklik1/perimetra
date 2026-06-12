"use client";

import { useLocale, useTranslations } from "@repo/i18n/web";
import type { DerivationResult, Issue } from "@repo/engine";
import { cn } from "@repo/ui";

/**
 * Live derivation output: category totals (off the I10 decimal-string money
 * boundary), the BOM, and every surfaced Issue (I5 — an invalid config shows
 * its typed problems, never a silent zero). Issue texts render as
 * `key + params` for now; the issue-key i18n catalog is a step-6 follow-up
 * (ConstraintDef.key doubles as the message key by design).
 */
export function ResultsPanel({ result }: { result: DerivationResult }) {
  const t = useTranslations("configurator");
  const locale = useLocale();
  // Display-only formatting: the exact decimal string is the value of record.
  const money = (decimal: string) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 3,
    }).format(Number(decimal));

  const categories = [
    ["totalMaterial", result.money.material],
    ["totalAccessory", result.money.accessory],
    ["totalManufacturing", result.money.manufacturing],
    ["totalInstallation", result.money.installation],
  ] as const;

  return (
    <section className="flex flex-col gap-4 text-sm">
      {result.issues.length > 0 && (
        <div className="border-border flex flex-col gap-1 rounded-md border p-4">
          <h2 className="font-semibold">{t("issues")}</h2>
          <ul className="flex flex-col gap-1">
            {result.issues.map((issue, i) => (
              <IssueLine key={`${issue.key}-${i}`} issue={issue} />
            ))}
          </ul>
        </div>
      )}

      {result.isValid && (
        <>
          <div className="border-border rounded-md border p-4">
            <h2 className="mb-2 font-semibold">{t("totals")}</h2>
            <dl className="grid grid-cols-2 gap-y-1">
              {categories.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{t(key)}</dt>
                  <dd className="text-right tabular-nums">{money(value)}</dd>
                </div>
              ))}
              <div className="border-border col-span-2 mt-1 border-t pt-1" />
              <dt className="font-semibold">{t("totalTotal")}</dt>
              <dd className="text-right font-semibold tabular-nums">{money(result.money.total)}</dd>
            </dl>
          </div>

          <div className="border-border rounded-md border p-4">
            <h2 className="mb-2 font-semibold">{t("bom")}</h2>
            <table className="w-full text-left">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase">
                  <th className="py-1 font-medium">{t("bomItem")}</th>
                  <th className="py-1 text-right font-medium">{t("bomQuantity")}</th>
                  <th className="py-1 text-right font-medium">{t("bomPrice")}</th>
                </tr>
              </thead>
              <tbody>
                {result.parts.map((part) => (
                  <tr key={part.path} className="border-border border-t">
                    <td className="py-1">{part.name}</td>
                    <td className="py-1 text-right tabular-nums">
                      {part.quantity} {part.unit}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {part.totalPrice !== undefined ? money(String(part.totalPrice)) : "—"}
                    </td>
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
          "rounded px-1.5 text-[10px] font-semibold uppercase",
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
