"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useApiClient, useMutation } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { type TaxBreakdown } from "@repo/model";
import { Button, DisplayLabel, Panel } from "@repo/ui";
import { formatDate } from "@repo/utils";
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

/**
 * The buyer-facing public link (CAR-16, ADR 0089's `/nabidka/:shareToken`
 * route) surfaced on the rep's own quote detail — so a rep can copy/paste it
 * to the buyer without hunting for the shareToken. Shown for every
 * effectively-non-draft status (issued and every state reachable from it —
 * accepted/declined/expired all keep working links, ADR 0083); a draft has no
 * shareable offer yet, so it renders nothing. `quote.status` is already the
 * READ-time effective status (`effectiveStatus`, computed server-side in
 * `quotes.service.ts`'s `toSummary` — never re-derived here), so an
 * `issued` quote past its `validUntil` already reads `expired` and gets the
 * warning below with no client-side clock logic.
 *
 * The origin is resolved post-mount (`useEffect`), never read during render:
 * this view hydrates from an RSC-prefetched query (`quote-detail-client.tsx`),
 * so the initial render can execute during SSR where `window` does not exist —
 * reading it inline would crash the server render and reading it behind a
 * `typeof window` branch would still mismatch the hydration pass. Rendering
 * nothing until the effect fills `origin` keeps server and first-client-render
 * markup identical.
 */
function BuyerLinkPanel({
  status,
  shareToken,
  validUntil,
  locale,
}: {
  status: QuoteDetail["status"];
  shareToken: string;
  validUntil: string | null;
  locale: string;
}) {
  const t = useTranslations("quotes");
  const [origin, setOrigin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const buyerUrl = origin !== null ? `${origin}/nabidka/${shareToken}` : null;
  const expired = status === "expired";
  const validUntilLabel = validUntil ? formatDate(validUntil, undefined, locale) : "";

  const copy = async () => {
    if (!buyerUrl) return;
    try {
      await navigator.clipboard.writeText(buyerUrl);
      setCopied(true);
    } catch {
      // Clipboard blocked (e.g. insecure context) — the link stays selectable/copyable by hand.
    }
  };

  return (
    <Panel elevation="flat">
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-lg">{t("buyerLink.title")}</h2>
        <p className="text-muted-foreground text-sm">
          {validUntil
            ? t("buyerLink.validUntil", { date: validUntilLabel })
            : t("buyerLink.noExpiry")}
        </p>
        {expired && (
          <p className="text-destructive text-sm" role="alert">
            {t("buyerLink.expiredWarning", { date: validUntilLabel })}
          </p>
        )}
        {buyerUrl && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-data bg-field text-foreground truncate rounded-md px-3 py-1.5 text-sm">
              {buyerUrl}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? t("buyerLink.copied") : t("buyerLink.copy")}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
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
        <div className="flex items-center gap-3">
          {/* Production (CAR-24) — only an effectively issued/accepted quote has
           *  a build; mirrors the api's `isProducible` gate so the link never
           *  dangles into a 404. */}
          {(quote.status === "issued" || quote.status === "accepted") && (
            <Link
              href={`/quotes/${quote.id}/production`}
              className="text-copper text-sm font-medium hover:underline"
            >
              {t("production.open")}
            </Link>
          )}
          <Link
            href={`/quotes/${quote.id}/nabidka`}
            className="text-copper text-sm font-medium hover:underline"
          >
            {t("nabidka.open")}
          </Link>
          <QuoteStatusBadge status={quote.status} />
        </div>
      </div>

      {/* The buyer link (CAR-16) — draft has nothing to share yet */}
      {quote.status !== "draft" && (
        <BuyerLinkPanel
          status={quote.status}
          shareToken={quote.shareToken}
          validUntil={quote.validUntil}
          locale={locale}
        />
      )}

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
