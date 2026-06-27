"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useLocale, useTranslations } from "@repo/i18n/web";
import type { NabidkaDocument } from "@repo/renderers";
import { Button } from "@repo/ui";

import { formatMoney } from "../../../../lib/format-money";

/**
 * The thin PDF/print SURFACE (M, ADR 0087) — lays out the pure-data
 * `NabidkaDocument` (L layer, ADR 0085) as a branded, A4 print-ready document.
 * No data logic: the page (RSC) builds the document off the frozen snapshot and
 * passes it here. Browser `print()` → PDF (no PDF dep; the repo embeds no binary
 * renderer). The brand fonts are the app-origin woff2 from `layout.tsx`
 * (ADR 0078), so the CSP `font-src 'self'` holds for the printed sheet too.
 *
 * Render-taste (weights/scale/accent) is owed to Martin's eye — built to the
 * Part-A brand hierarchy; the specimen is the calibration target.
 *
 * Reused by both surfaces (ADR 0089): the authed rep print route passes
 * `backHref` (← back to the quote); the public buyer route passes `actions` (the
 * accept/decline bar) and no back link. Both slots are optional + no-print.
 */
export function NabidkaDocumentView({
  doc,
  backHref,
  actions,
}: {
  doc: NabidkaDocument;
  backHref?: string;
  actions?: ReactNode;
}) {
  const t = useTranslations("quotes");
  const locale = useLocale();
  const money = (d: string) => formatMoney(d, locale);
  const reverse = doc.tax.mode === "reverse_charge_92e";
  const supp = doc.supplier;
  const cust = doc.customer;
  // Literal keys (next-intl's typed `t` rejects dynamic template-literal keys).
  const categoryLabel: Record<NabidkaDocument["categories"][number]["key"], string> = {
    material: t("nabidka.categories.material"),
    accessory: t("nabidka.categories.accessory"),
    manufacturing: t("nabidka.categories.manufacturing"),
    installation: t("nabidka.categories.installation"),
  };

  return (
    <main className="bg-field min-h-screen">
      {/* @page margins + screen/print toggles — inline style is CSP-allowed
          (style-src 'self' 'unsafe-inline'); @page cannot be a Tailwind utility. */}
      <style>{`@page { size: A4; margin: 18mm 16mm; } @media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>

      {/* Toolbar — screen only */}
      <div className="no-print mx-auto flex w-full max-w-[210mm] items-center justify-between gap-4 px-6 pt-6">
        {backHref ? (
          <Link href={backHref} className="text-muted-foreground text-sm hover:underline">
            ← {t("title")}
          </Link>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {actions}
          <Button type="button" variant="copper-outline" onClick={() => window.print()}>
            {t("nabidka.print")}
          </Button>
        </div>
      </div>

      {/* The document sheet */}
      <article className="bg-background text-foreground mx-auto my-6 w-full max-w-[210mm] p-10 shadow-sm print:my-0 print:p-0 print:shadow-none">
        <header className="border-border mb-8 flex items-start justify-between border-b pb-6">
          <h1 className="font-display text-3xl">{t("nabidka.title")}</h1>
          <p className="font-data text-muted-foreground text-sm">{doc.documentNumber}</p>
        </header>

        {/* Parties */}
        <section className="mb-8 grid grid-cols-2 gap-8 text-sm">
          <div>
            <h2 className="font-display text-muted-foreground mb-2 text-xs uppercase tracking-wide">
              {t("nabidka.supplier")}
            </h2>
            {supp ? (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{supp.name}</span>
                {supp.addressLine && <span>{supp.addressLine}</span>}
                {(supp.postalCode || supp.city) && (
                  <span>{[supp.postalCode, supp.city].filter(Boolean).join(" ")}</span>
                )}
                {supp.ico && (
                  <span className="font-data text-xs">
                    {t("nabidka.ico")}: {supp.ico}
                  </span>
                )}
                {supp.dic && (
                  <span className="font-data text-xs">
                    {t("nabidka.dic")}: {supp.dic}
                  </span>
                )}
                {supp.bankAccount && (
                  <span className="font-data text-xs">
                    {t("nabidka.bankAccount")}: {supp.bankAccount}
                  </span>
                )}
                {supp.registrationNote && (
                  <span className="text-muted-foreground mt-1 text-xs">
                    {supp.registrationNote}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground italic">{t("nabidka.supplierTodo")}</p>
            )}
          </div>
          <div>
            <h2 className="font-display text-muted-foreground mb-2 text-xs uppercase tracking-wide">
              {t("nabidka.customer")}
            </h2>
            {cust ? (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{cust.name}</span>
                {cust.addressLine && <span>{cust.addressLine}</span>}
                {(cust.postalCode || cust.city) && (
                  <span>{[cust.postalCode, cust.city].filter(Boolean).join(" ")}</span>
                )}
                {cust.ico && (
                  <span className="font-data text-xs">
                    {t("nabidka.ico")}: {cust.ico}
                  </span>
                )}
                {cust.dic && (
                  <span className="font-data text-xs">
                    {t("nabidka.dic")}: {cust.dic}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("nabidka.noCustomer")}</p>
            )}
          </div>
        </section>

        {/* Line items */}
        <section className="mb-8">
          <h2 className="font-display mb-3 text-lg">{t("nabidka.items")}</h2>
          <table className="font-data w-full text-sm tabular-nums">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th className="py-1 font-medium">{t("nabidka.colItem")}</th>
                <th className="py-1 text-right font-medium">{t("nabidka.colQty")}</th>
                <th className="py-1 text-right font-medium">{t("nabidka.colUnit")}</th>
                <th className="py-1 text-right font-medium">{t("nabidka.colPrice")}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line) => (
                <tr key={line.componentCode} className="border-border/50 border-b">
                  <td className="py-1.5">
                    <span className="font-sans">{line.name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{line.componentCode}</span>
                  </td>
                  <td className="py-1.5 text-right">{line.quantity}</td>
                  <td className="py-1.5 text-right">{line.unit}</td>
                  <td className="py-1.5 text-right">{money(line.totalPriceMoney)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Category subtotals (net) */}
        <section className="mb-8">
          <h2 className="font-display text-muted-foreground mb-2 text-xs uppercase tracking-wide">
            {t("nabidka.subtotals")}
          </h2>
          <table className="font-data ml-auto w-1/2 text-sm tabular-nums">
            <tbody>
              {doc.categories
                .filter((c) => Number(c.total) !== 0)
                .map((c) => (
                  <tr key={c.key}>
                    <td className="py-0.5">{categoryLabel[c.key]}</td>
                    <td className="py-0.5 text-right">{money(c.total)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        {/* The §92e/DPH tax document */}
        <section className="mb-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg">{t("taxDocument")}</h2>
            <span className="text-muted-foreground font-data text-xs uppercase tracking-wide">
              {reverse ? t("tax.reverseCharge") : t("tax.standard")}
            </span>
          </div>
          <table className="font-data mt-3 w-full text-sm tabular-nums">
            <thead>
              <tr className="text-muted-foreground border-border border-b text-left text-xs">
                <th className="py-1 font-medium">{t("tax.rate")}</th>
                <th className="py-1 text-right font-medium">{t("tax.net")}</th>
                <th className="py-1 text-right font-medium">{t("tax.vat")}</th>
                <th className="py-1 text-right font-medium">{t("tax.gross")}</th>
              </tr>
            </thead>
            <tbody>
              {doc.tax.lines.map((line) => (
                <tr key={line.ratePct} className="border-border/50 border-b">
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
                <td className="pt-2 text-right">{money(doc.netTotal)}</td>
                <td className="pt-2 text-right">{reverse ? "—" : money(doc.vatTotal)}</td>
                <td className="text-copper pt-2 text-right text-base">{money(doc.grossTotal)}</td>
              </tr>
            </tfoot>
          </table>
          {doc.legend && (
            <p className="bg-field text-foreground mt-3 rounded-md p-3 text-sm">{doc.legend}</p>
          )}
        </section>

        <footer className="border-border text-muted-foreground mt-10 border-t pt-4 text-xs">
          {t("nabidka.generatedNote")}
        </footer>
      </article>
    </main>
  );
}
