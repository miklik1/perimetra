"use client";

import { useApiClient, useMutation } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { type TaxBreakdown } from "@repo/model";
import { Button, DisplayLabel, Panel } from "@repo/ui";
import { type QuoteDetail } from "@repo/validators";

import { errorMessageKey } from "../../../lib/error-messages";
import { formatMoney } from "../../../lib/format-money";
import { createQuotesQueries } from "../../../lib/quotes-queries";
import { QuoteStatusBadge } from "../quote-status";

/** The opaque snapshot, narrowed to the fields this surface reads. */
interface QuoteSnapshot {
  money: { total: string };
  tax: TaxBreakdown;
}

export function QuoteDetailView({ quote }: { quote: QuoteDetail }) {
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const quotesQueries = createQuotesQueries(useApiClient());
  const verifyMutation = useMutation(quotesQueries.verify());

  const snapshot = quote.snapshot as QuoteSnapshot | null;
  const tax = snapshot?.tax;
  const money = (decimal: string) => formatMoney(decimal, locale);
  const reverse = tax?.mode === "reverse_charge_92e";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <DisplayLabel as="h1" className="font-data">
          {quote.documentNumber}
        </DisplayLabel>
        <QuoteStatusBadge status={quote.status} />
      </div>

      {/* The tax document */}
      {tax && (
        <Panel elevation="raised">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg">{t("taxDocument")}</h2>
              <span className="text-muted-foreground font-data text-xs uppercase tracking-wide">
                {reverse ? t("tax.reverseCharge") : t("tax.standard")}
              </span>
            </div>

            <table className="font-data w-full text-sm tabular-nums">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left text-xs">
                  <th className="py-1 font-medium">{t("tax.rate")}</th>
                  <th className="py-1 text-right font-medium">{t("tax.net")}</th>
                  <th className="py-1 text-right font-medium">{t("tax.vat")}</th>
                  <th className="py-1 text-right font-medium">{t("tax.gross")}</th>
                </tr>
              </thead>
              <tbody>
                {tax.lines.map((line) => (
                  <tr key={line.ratePct} className="border-border/60 border-b">
                    <td className="py-1.5">{line.ratePct} %</td>
                    <td className="py-1.5 text-right">{money(line.netBase)}</td>
                    <td className="py-1.5 text-right">{reverse ? "—" : money(line.vatAmount)}</td>
                    <td className="py-1.5 text-right">{money(line.gross)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td className="pt-2">{t("tax.total")}</td>
                  <td className="pt-2 text-right">{money(tax.netTotal)}</td>
                  <td className="pt-2 text-right">{reverse ? "—" : money(tax.vatTotal)}</td>
                  <td className="text-copper pt-2 text-right">{money(tax.grossTotal)}</td>
                </tr>
              </tfoot>
            </table>

            {reverse && tax.legend && (
              <p className="bg-field text-foreground rounded-md p-3 text-sm">{tax.legend}</p>
            )}
          </div>
        </Panel>
      )}

      {/* Reproducibility — reframed as a customer-facing TRUST feature (ADR 0083) */}
      <Panel elevation="flat">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-lg">{t("trust.title")}</h2>
          <p className="text-muted-foreground text-sm">{t("trust.body")}</p>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="copper-outline"
              onClick={() => verifyMutation.mutate(quote.id)}
              disabled={verifyMutation.isPending}
            >
              {verifyMutation.isPending ? t("trust.verifying") : t("trust.verify")}
            </Button>
            {verifyMutation.data?.reproduced === true && (
              <span className="text-sm font-medium text-green-700" role="status">
                ✓ {t("trust.reproduced")}
              </span>
            )}
            {verifyMutation.data?.reproduced === false && (
              <span className="text-destructive text-sm font-medium" role="status">
                ✗ {t("trust.mismatch")}
              </span>
            )}
            {verifyMutation.error && (
              <span className="text-destructive text-sm" role="alert">
                {tErrors(errorMessageKey(verifyMutation.error))}
              </span>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
