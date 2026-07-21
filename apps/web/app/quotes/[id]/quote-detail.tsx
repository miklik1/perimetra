"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useApiClient, useMutation } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { type BomCategory, type BomUnit, type TaxBreakdown } from "@repo/model";
import { Badge, Button, DisplayLabel, Icon, KeyValueList, Panel } from "@repo/ui";
import { formatDate } from "@repo/utils";
import { type QuoteDetail } from "@repo/validators";

import { errorMessageKey } from "../../../lib/error-messages";
import { formatMoney } from "../../../lib/format-money";
import { createQuotesQueries } from "../../../lib/quotes-queries";
import { QuoteStatusBadge } from "../quote-status";

/**
 * One aggregated BOM line off the frozen snapshot (§3.2 gap-fill) — mirrors
 * `SiteBomLine` (`@repo/engine`), hand-copied the same zero-dep-leaf way
 * `@repo/validators`' `productionBomLineSchema` mirrors it (this app can import
 * `@repo/model`'s value types but not the engine). `totalPriceMoney` is
 * OPTIONAL: the server's `blindSnapshot` (`quotes.service.ts`) whitelists every
 * OTHER field through for the price-blind `workshop` role but drops this one —
 * a workshop viewer's `snapshot.bom` lines simply do not carry it on the wire.
 * Read it ONLY behind the same `quote.total !== null` gate the top-line total
 * already uses (bomDecision.priceBlindGate) — never render it unconditionally.
 */
interface QuoteBomLine {
  componentCode: string;
  name: string;
  unit: BomUnit;
  category: BomCategory;
  quantity: number;
  totalPriceMoney?: string;
  sources: { instanceId: string; path: string }[];
}

/** The opaque snapshot, narrowed to the fields this surface reads. `bom` is
 *  optional — a pre-slice snapshot (or the current MSW mock) carries none, so
 *  the aggregated-BOM section degrades to nothing rather than fabricating rows. */
interface QuoteSnapshot {
  money: { total: string };
  tax: TaxBreakdown;
  bom?: QuoteBomLine[];
}

/** `BomUnit` → its i18n key. Reuses the CONFIGURATOR catalog's existing
 *  `unit*` keys (the same ones `bom-table.tsx` reads) rather than duplicating
 *  them under `quotes` — one unit vocabulary, two surfaces. `satisfies
 *  Record<BomUnit, …>` keeps the map exhaustive over the union. */
const UNIT_KEY = {
  meter: "unitMeter",
  piece: "unitPiece",
  set: "unitSet",
  hour: "unitHour",
} as const satisfies Record<BomUnit, string>;

/** Shared "document table" chrome (Perimetra Nabidka.html `.price`, translated
 *  to tokens): a rounded bordered box, uppercase muted heads on
 *  `bg-chrome-subtle`, hairline `border-border` rows, a `.sum`-style totals row
 *  (`border-t-2 border-primary bg-spotlight-subtle`). Shared by the §92e tax
 *  table and the aggregated BOM table below so both read as one document
 *  vocabulary rather than two ad hoc tables. */
const DOC_TABLE_WRAP = "border-border overflow-hidden rounded-card border";
const DOC_TABLE_HEAD_ROW = "bg-chrome-subtle text-muted-foreground text-left text-xs";
const DOC_TABLE_HEAD_CELL = "px-4 py-2.5 font-medium uppercase tracking-wide";
const DOC_TABLE_BODY_ROW = "border-border border-t";
const DOC_TABLE_BODY_CELL = "px-4 py-2.5";
const DOC_TABLE_SUM_ROW = "border-primary bg-spotlight-subtle border-t-2";

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

/** The revision-lineage gap-fill (§3.2, ADR-O1/CAR-158): a quote carries only
 *  the sibling's UUID, never its documentNumber (`quoteSummarySchema` doesn't
 *  carry it) — so the indicator links BY ID with a generic label rather than
 *  fetching the sibling's own summary (a deferred second round-trip, recorded
 *  as a deviation). `tone` distinguishes "you're looking at a stale copy"
 *  (superseded — the live head is elsewhere) from "this is itself a later
 *  revision" (informational only). */
function LineagePanel({
  icon,
  title,
  body,
  href,
  linkLabel,
}: {
  icon: "warn" | "layers";
  title: string;
  body: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <Panel elevation="flat">
      <div className="flex items-start gap-3">
        <Icon name={icon} aria-hidden className="text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg">{title}</h2>
          <p className="text-muted-foreground text-sm">{body}</p>
          <Link href={href} className="text-copper text-sm font-medium hover:underline">
            {linkLabel}
          </Link>
        </div>
      </div>
    </Panel>
  );
}

export function QuoteDetailView({ quote }: { quote: QuoteDetail }) {
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const tConfig = useTranslations("configurator");
  const locale = useLocale();
  const quotesQueries = createQuotesQueries(useApiClient());
  const verifyMutation = useMutation(quotesQueries.verify());

  const snapshot = quote.snapshot as QuoteSnapshot | null;
  const tax = snapshot?.tax;
  const bom = snapshot?.bom;
  const priced = quote.total !== null;
  const money = (decimal: string) => formatMoney(decimal, locale);
  const quantity = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
  const reverse = tax?.mode === "reverse_charge_92e";
  const categoryLabel: Record<BomCategory, string> = {
    material: t("nabidka.categories.material"),
    accessory: t("nabidka.categories.accessory"),
    manufacturing: t("nabidka.categories.manufacturing"),
    installation: t("nabidka.categories.installation"),
  };

  return (
    <div className="flex flex-col gap-6">
      {/* The Nabídka document titleband (Perimetra Nabidka.html .titleband) */}
      <div className="border-primary flex flex-col gap-4 border-b-2 pb-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            {t("detail.eyebrow")}
          </span>
          <DisplayLabel as="h1" className="font-data text-3xl sm:text-4xl">
            {quote.documentNumber}
          </DisplayLabel>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex flex-wrap items-center gap-3">
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
          <KeyValueList className="w-full min-w-56">
            <KeyValueList.Row label={t("detail.number")} mono>
              {quote.documentNumber}
            </KeyValueList.Row>
            <KeyValueList.Row label={t("detail.issuedAt")}>
              {formatDate(quote.createdAt, { dateStyle: "medium" }, locale)}
            </KeyValueList.Row>
            {/* Validity gap-fill (§3.2) — the header carries this fact even when
             *  no buyer-link panel renders below (e.g. a draft). */}
            <KeyValueList.Row label={t("detail.validUntil")}>
              {quote.validUntil
                ? formatDate(quote.validUntil, { dateStyle: "medium" }, locale)
                : t("detail.noExpiry")}
            </KeyValueList.Row>
          </KeyValueList>
        </div>
      </div>

      {/* Revision lineage (§3.2, ADR-O1/CAR-158) */}
      {quote.supersededById !== null && (
        <LineagePanel
          icon="warn"
          title={t("lineage.supersededTitle")}
          body={t("lineage.supersededBody")}
          href={`/quotes/${quote.supersededById}`}
          linkLabel={t("lineage.viewSuperseding")}
        />
      )}
      {quote.revisionOfId !== null && (
        <LineagePanel
          icon="layers"
          title={t("lineage.revisionTitle")}
          body={t("lineage.revisionBody")}
          href={`/quotes/${quote.revisionOfId}`}
          linkLabel={t("lineage.viewOriginal")}
        />
      )}

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

            <div className={DOC_TABLE_WRAP}>
              <div className="overflow-x-auto">
                <table className="font-data w-full text-sm tabular-nums">
                  <thead>
                    <tr className={DOC_TABLE_HEAD_ROW}>
                      <th className={DOC_TABLE_HEAD_CELL}>{t("tax.rate")}</th>
                      <th className={`${DOC_TABLE_HEAD_CELL} text-right`}>{t("tax.net")}</th>
                      <th className={`${DOC_TABLE_HEAD_CELL} text-right`}>{t("tax.vat")}</th>
                      <th className={`${DOC_TABLE_HEAD_CELL} text-right`}>{t("tax.gross")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tax.lines.map((line) => (
                      <tr key={line.ratePct} className={DOC_TABLE_BODY_ROW}>
                        <td className={DOC_TABLE_BODY_CELL}>{line.ratePct} %</td>
                        <td className={`${DOC_TABLE_BODY_CELL} text-right`}>
                          {money(line.netBase)}
                        </td>
                        <td className={`${DOC_TABLE_BODY_CELL} text-right`}>
                          {reverse ? "—" : money(line.vatAmount)}
                        </td>
                        <td className={`${DOC_TABLE_BODY_CELL} text-right`}>{money(line.gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={DOC_TABLE_SUM_ROW}>
                      <td className={`${DOC_TABLE_BODY_CELL} font-display font-semibold`}>
                        {t("tax.total")}
                      </td>
                      <td className={`${DOC_TABLE_BODY_CELL} text-right`}>{money(tax.netTotal)}</td>
                      <td className={`${DOC_TABLE_BODY_CELL} text-right`}>
                        {reverse ? "—" : money(tax.vatTotal)}
                      </td>
                      <td
                        className={`${DOC_TABLE_BODY_CELL} text-copper text-right text-base font-semibold`}
                      >
                        {money(tax.grossTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {reverse && tax.legend && (
              <p className="bg-field text-foreground rounded-md p-3 text-sm">{tax.legend}</p>
            )}
          </div>
        </Panel>
      )}

      {/* Aggregated site BOM (§3.2 gap-fill, bomDecision.ship). Component/name/
       *  unit/category/quantity/sources render ALWAYS; the Cena column — and
       *  every per-line price cell — renders ONLY behind `priced`
       *  (`quote.total !== null`), the exact gate the top-line total already
       *  uses. A snapshot without `bom` (pre-slice quotes, the current MSW
       *  mock) omits the whole section rather than showing an empty table. */}
      {bom && bom.length > 0 && (
        <Panel elevation="raised">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg">{t("bom.title")}</h2>
            <div className={DOC_TABLE_WRAP}>
              <div className="overflow-x-auto">
                <table className="font-data w-full text-sm">
                  <thead>
                    <tr className={DOC_TABLE_HEAD_ROW}>
                      <th className={DOC_TABLE_HEAD_CELL}>{t("bom.colItem")}</th>
                      <th className={DOC_TABLE_HEAD_CELL}>{t("bom.colCategory")}</th>
                      <th className={`${DOC_TABLE_HEAD_CELL} text-right`}>
                        {t("bom.colQuantity")}
                      </th>
                      <th className={DOC_TABLE_HEAD_CELL}>{t("bom.colSources")}</th>
                      {priced && (
                        <th className={`${DOC_TABLE_HEAD_CELL} text-right`}>{t("bom.colPrice")}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {bom.map((line) => {
                      const instanceIds = Array.from(
                        new Set(line.sources.map((source) => source.instanceId)),
                      );
                      return (
                        <tr key={line.componentCode} className={DOC_TABLE_BODY_ROW}>
                          <td className={DOC_TABLE_BODY_CELL}>
                            <div className="flex flex-col gap-0.5">
                              <span>{line.name}</span>
                              <span className="text-muted-foreground font-mono text-xs">
                                {line.componentCode}
                              </span>
                            </div>
                          </td>
                          <td className={DOC_TABLE_BODY_CELL}>
                            <Badge tone="outline">{categoryLabel[line.category]}</Badge>
                          </td>
                          <td className={`${DOC_TABLE_BODY_CELL} text-right tabular-nums`}>
                            {quantity(line.quantity)} {tConfig(UNIT_KEY[line.unit])}
                          </td>
                          <td
                            className={`${DOC_TABLE_BODY_CELL} text-muted-foreground font-mono text-xs`}
                          >
                            {instanceIds.join(", ")}
                          </td>
                          {priced && (
                            <td className={`${DOC_TABLE_BODY_CELL} text-right tabular-nums`}>
                              {line.totalPriceMoney !== undefined
                                ? money(line.totalPriceMoney)
                                : "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Panel>
      )}
      {bom && bom.length === 0 && (
        <Panel elevation="flush">
          <p className="text-muted-foreground text-sm">{t("bom.empty")}</p>
        </Panel>
      )}

      {/* Reproducibility — the customer-facing TRUST feature (ADR 0083), §3.2:
       *  "the thing no competitor has, a first-class design element" — fronted
       *  with the same `reproduce` glyph the canvas validity pill uses. */}
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
              <Icon name="reproduce" aria-hidden />
              {verifyMutation.isPending ? t("trust.verifying") : t("trust.verify")}
            </Button>
            {verifyMutation.data?.reproduced === true && (
              <span className="text-success text-sm font-medium" role="status">
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
