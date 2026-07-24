"use client";

import { useLocale, useTranslations } from "@repo/i18n/web";
import { Alert, Badge, Button, DisplayLabel, Panel, StickyActionBar } from "@repo/ui";
import { formatDate } from "@repo/utils";
import type { NabidkaDocumentDto, QuoteStatus } from "@repo/validators";

import { formatMoney } from "../../../lib/format-money";
import { QuoteStatusBadge } from "../../quotes/quote-status";

/**
 * The buyer-facing PUBLIC nabídka LANDING (ADR-0089 reversal, Wave B) — a
 * branded conversion surface, distinct from the internal `/quotes/:id` detail
 * and from the `NabidkaDocumentView` print twin (ADR 0087/0089), which this
 * route no longer renders. Built to `design/configurator/frames-quote.jsx`'s
 * LOOK (brand lockup, validity pill, copper accept CTA, "V ceně je"-style
 * cards) but HONEST to the trust boundary: every field rendered here comes off
 * `sharedNabidkaSchema` — the real BOM `lines[]`/`categories[]`, the real
 * `tax` breakdown, the real `validUntil`/`superseded` flags. No 3D drawing, no
 * curated spec list, no perks copy, no sales-rep card, no fabricated order
 * number or fulfillment timeline (none of that is backend truth for this
 * surface).
 *
 * One responsive tree (not two separate desktop/mobile components, unlike the
 * canvas frames): the sticky bottom action bar (`@repo/ui` `StickyActionBar`)
 * carries the price + Accept/Decline at EVERY breakpoint. A literal
 * desktop-only duplicate of the same buttons was considered (the canvas draws
 * a separate right-column card) and rejected — two live copies of the same
 * accessible name is untestable (jsdom does not apply the Tailwind stylesheet
 * that would hide one of them) and is not better UX than one reliable bar.
 */
export type NabidkaLandingViewProps = {
  doc: NabidkaDocumentDto;
  status: QuoteStatus;
  validUntil: string | null;
  superseded: boolean;
  pending: boolean;
  errored: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export function NabidkaLandingView({
  doc,
  status,
  validUntil,
  superseded,
  pending,
  errored,
  onAccept,
  onDecline,
}: NabidkaLandingViewProps) {
  const t = useTranslations("quotes");
  const locale = useLocale();
  const money = (decimal: string) => formatMoney(decimal, locale);

  // Actionable = the buyer may still resolve this offer. `superseded` is an
  // ORTHOGONAL fact to `status` (ADR-O1/CAR-158: supersession never rewrites
  // `status`), so both gates apply — an `issued`-but-superseded quote must not
  // show the CTA even though its status alone would allow it.
  const actionable = status === "issued" && !superseded;

  const greeting = doc.customer?.name
    ? t("buyer.greetingNamed", { name: doc.customer.name })
    : t("buyer.greetingGeneric");

  let validityLabel: string | null = null;
  if (actionable && validUntil) {
    const days = Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86_400_000);
    validityLabel =
      days >= 1
        ? t("buyer.validityDays", { days })
        : t("buyer.validityDate", {
            date: formatDate(validUntil, { dateStyle: "medium" }, locale),
          });
  }

  return (
    <main className="bg-field flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:gap-8 lg:px-8 lg:py-12">
        <header className="flex items-center justify-between gap-4">
          <BrandMark tagline={t("buyer.tagline")} />
          <span className="text-muted-foreground font-mono text-xs">{doc.documentNumber}</span>
        </header>

        {/* The real gap this wave closes (ADR-O1/CAR-158): the endpoint has
            always returned `superseded`, unrendered until now. */}
        {superseded && (
          <Alert tone="warning">
            <Alert.Icon />
            <Alert.Title>{t("buyer.supersededTitle")}</Alert.Title>
            <Alert.Description>{t("buyer.supersededBody")}</Alert.Description>
          </Alert>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* The warm, buyer-facing "ready" framing (canvas `Badge tone="copper"`)
                ONLY while actionable — saying "ready" on a superseded or
                already-resolved offer would be dishonest. Every other state
                falls back to `QuoteStatusBadge`, the SAME status vocabulary the
                rep sees, so it never invents a second name for one status —
                EXCEPT under supersession: `QuoteStatusBadge` maps `issued`→copper
                (the same "live/actionable" accent), which would re-introduce the
                dishonest signal the `actionable` gate just removed, so a
                superseded offer carries no status badge and the warning Alert
                above is its sole state signal. */}
            {actionable ? (
              <Badge tone="copper">{t("buyer.readyBadge")}</Badge>
            ) : superseded ? null : (
              <QuoteStatusBadge status={status} />
            )}
            {validityLabel && (
              <span className="bg-copper text-copper-foreground inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold">
                {validityLabel}
              </span>
            )}
          </div>
          <DisplayLabel as="h1">{greeting}</DisplayLabel>
          {actionable && (
            <p className="text-muted-foreground max-w-xl text-sm sm:text-base">
              {t("buyer.intro")}
            </p>
          )}
          {status === "accepted" && (
            <Alert tone="success">
              <Alert.Icon />
              <Alert.Title>{t("buyer.accepted")}</Alert.Title>
            </Alert>
          )}
          {status === "declined" && (
            <Alert tone="info">
              <Alert.Icon />
              <Alert.Title>{t("buyer.declined")}</Alert.Title>
            </Alert>
          )}
          {status === "expired" && (
            <Alert tone="warning">
              <Alert.Icon />
              <Alert.Title>{t("buyer.expired")}</Alert.Title>
            </Alert>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            <PartiesPanel doc={doc} />
            <BomPanel doc={doc} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <PricePanel doc={doc} />
          </div>
        </div>
      </div>

      {actionable && (
        <StickyActionBar tone="chrome" aria-label={t("buyer.totalCaption")}>
          <StickyActionBar.Price>
            <span className="text-muted-foreground text-xs">{t("buyer.totalCaption")}</span>
            <span className="font-data text-lg font-semibold tabular-nums sm:text-xl">
              {money(doc.grossTotal)}
            </span>
          </StickyActionBar.Price>
          <StickyActionBar.Action>
            <Button type="button" variant="outline" disabled={pending} onClick={onDecline}>
              {t("buyer.decline")}
            </Button>
            <Button type="button" variant="copper" disabled={pending} onClick={onAccept}>
              {t("buyer.accept")}
            </Button>
          </StickyActionBar.Action>
          {errored && (
            <StickyActionBar.Note tone="destructive">{t("buyer.error")}</StickyActionBar.Note>
          )}
        </StickyActionBar>
      )}
    </main>
  );
}

/** The brand lockup — an app-land port of the canvas `brand()` helper (a
 *  design authority for the LOOK only; the mark is a plain "P" chip, no image
 *  asset). */
function BrandMark({ tagline }: { tagline: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="bg-primary text-primary-foreground font-display rounded-control flex h-8 w-8 shrink-0 items-center justify-center text-base font-semibold">
        P
      </div>
      <div className="leading-tight">
        <div className="font-display text-sm font-semibold">Perimetra</div>
        <div className="text-muted-foreground text-[11px]">{tagline}</div>
      </div>
    </div>
  );
}

/** Supplier (dodavatel) / customer (odběratel) identity — the same absence
 *  handling as `NabidkaDocumentView` ("Bez odběratele" for a quote with no
 *  attached buyer), re-implemented at landing scale rather than shared, per
 *  the fork (`NabidkaDocumentView` stays untouched for the print route). */
function PartiesPanel({ doc }: { doc: NabidkaDocumentDto }) {
  const t = useTranslations("quotes");
  const supp = doc.supplier;
  const cust = doc.customer;

  return (
    <Panel elevation="flat" className="min-w-0">
      <div className="grid gap-6 text-sm sm:grid-cols-2">
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
            {t("nabidka.supplier")}
          </div>
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
            </div>
          ) : (
            <p className="text-muted-foreground italic">{t("nabidka.supplierTodo")}</p>
          )}
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
            {t("nabidka.customer")}
          </div>
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
      </div>
    </Panel>
  );
}

/** The REAL BOM — `document.lines[]` + per-category net subtotals — in place
 *  of the canvas's curated `specList()` (Produkt/Rozměr/Výplň/…, which has no
 *  backend field to read from). */
function BomPanel({ doc }: { doc: NabidkaDocumentDto }) {
  const t = useTranslations("quotes");
  const locale = useLocale();
  const money = (decimal: string) => formatMoney(decimal, locale);
  const categoryLabel: Record<NabidkaDocumentDto["categories"][number]["key"], string> = {
    material: t("nabidka.categories.material"),
    accessory: t("nabidka.categories.accessory"),
    manufacturing: t("nabidka.categories.manufacturing"),
    installation: t("nabidka.categories.installation"),
  };

  return (
    <Panel elevation="flat" className="min-w-0">
      <Panel.Header>
        <Panel.Title>{t("nabidka.items")}</Panel.Title>
      </Panel.Header>
      <Panel.Body>
        <div className="min-w-0 overflow-x-auto">
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
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
            {t("nabidka.subtotals")}
          </div>
          <table className="font-data ml-auto w-full max-w-xs text-sm tabular-nums">
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
        </div>
      </Panel.Body>
    </Panel>
  );
}

/** The real §92e/DPH breakdown — net / per-rate DPH / gross — mirroring
 *  `NabidkaDocumentView`'s reverse-charge handling (a re-implementation, per
 *  the fork, not a shared import).
 *
 *  This is the PUBLIC buyer surface, so the title is the load-bearing part: a
 *  nabídka is not a §29 daňový doklad (own number series, no DUZP, no payment
 *  block, VAT derived bottom-up vs the invoice kernel's §37 top-down), and a
 *  buyer who reads "Daňový doklad" here has been told something false about
 *  what they are holding. `vatBreakdown` claims only what the table is. */
function PricePanel({ doc }: { doc: NabidkaDocumentDto }) {
  const t = useTranslations("quotes");
  const locale = useLocale();
  const money = (decimal: string) => formatMoney(decimal, locale);
  const reverse = doc.tax.mode === "reverse_charge_92e";

  return (
    <Panel elevation="raised" className="min-w-0">
      <Panel.Header>
        <Panel.Title>{t("vatBreakdown")}</Panel.Title>
        <span className="text-muted-foreground font-data ml-auto text-xs uppercase tracking-wide">
          {reverse ? t("tax.reverseCharge") : t("tax.standard")}
        </span>
      </Panel.Header>
      <Panel.Body>
        <div className="min-w-0 overflow-x-auto">
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
        </div>
        {doc.legend && (
          <p className="bg-field text-foreground mt-3 rounded-md p-3 text-sm">{doc.legend}</p>
        )}
      </Panel.Body>
    </Panel>
  );
}
