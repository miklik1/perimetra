"use client";

import Link from "next/link";

import { useApiClient, useInfiniteQuery } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Badge, Button, EmptyState, Icon, Skeleton } from "@repo/ui";
import { formatCalendarDate } from "@repo/utils";

import { errorMessageKey } from "../../lib/error-messages";
import { formatMoney } from "../../lib/format-money";
import { createInvoicesQueries } from "../../lib/invoices-queries";
import { InvoiceStatusBadge } from "./invoice-status";

/**
 * Per-rep invoices list (ADR 0112 / ADR 0127 Wave A1), in the shipped o-LIST
 * table language (ADR 0121, design/README.md §6/§11.1) the quotes and orders
 * indexes already speak: a bare, accessible `<table>` — uppercase muted column
 * heads, hairline-divided rows, per-row hover. Infinite keyset pagination
 * (UUIDv7 ids), first page hydrated from the RSC prefetch.
 *
 * Each row is ONE focusable stretched-link anchor (the document-number cell) to
 * `/invoices/:id` — full-row click/tap and a single tab stop per row. The
 * superseded marker beside the status badge is inert markup (a `Badge`, never a
 * second anchor), so the row keeps exactly one link.
 *
 * Two honest differences from the quotes table: `total` has NO absence branch —
 * there is no price-blind projection of an invoice (workshop is 403 on the whole
 * module, ADR 0112), so `InvoiceSummary.total` is non-nullable and a missing
 * number would be a bug, not a redaction. And the fourth column is `dueOn`
 * (non-nullable) rather than an expiry: what a rep scans an invoice list for is
 * what is owed and by when.
 *
 * `dueOn` is an `isoDate` CALENDAR day, so it renders through
 * `formatCalendarDate` (UTC-pinned, ADR 0105) — in lockstep with the detail
 * titleband, so the two surfaces can never state a different due date.
 *
 * Money here is the ROW's I10 decimal koruna string through `formatMoney` — NOT
 * the frozen document's kernel `formatCents` output, which is rendered verbatim
 * and lives only on the print sheet. The two money classes must never meet on
 * one screen (ADR 0127 §3.4).
 */
export function InvoicesList() {
  const t = useTranslations("invoices");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const invoicesQueries = createInvoicesQueries(useApiClient());

  const { data, error, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(invoicesQueries.list());
  const invoices = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex w-full flex-col gap-4">
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {tErrors(errorMessageKey(error))}
        </p>
      )}
      {isPending && !error && (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {!isPending && invoices.length === 0 && !error && (
        <EmptyState>
          <EmptyState.Icon>
            <Icon name="save" />
          </EmptyState.Icon>
          <EmptyState.Title>{t("empty")}</EmptyState.Title>
          <EmptyState.Description>{t("emptyDescription")}</EmptyState.Description>
        </EmptyState>
      )}
      {invoices.length > 0 && (
        // `relative` + `min-w-0` are both load-bearing (ADR 0121): without
        // `relative` the rows' stretched-link `after:inset-0` pseudos escape this
        // container and scroll the BODY horizontally at 390px; without `min-w-0`
        // the flex item cannot shrink below its content's automatic minimum.
        // Cells also carry `pr-4 last:pr-0`. The shipped o-LIST surfaces rely on
        // the browser's natural table spacing, which holds while a row is
        // narrower than the viewport — an invoice row is not (document number +
        // two badges + a date + a money total), so at 390px the columns butt
        // together and read "ČÍSLO DOKLADUSTAV" / "7. 8. 2026157 168,72 Kč".
        // The separation is the same list language, not a second one.
        <div className="relative min-w-0 overflow-x-auto">
          <table aria-label={t("tableLabel")} className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 pr-4 text-left text-xs font-medium uppercase tracking-wide last:pr-0"
                >
                  {t("columns.documentNumber")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 pr-4 text-left text-xs font-medium uppercase tracking-wide last:pr-0"
                >
                  {t("columns.status")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 pr-4 text-right text-xs font-medium uppercase tracking-wide last:pr-0"
                >
                  {t("columns.dueOn")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 pr-4 text-right text-xs font-medium uppercase tracking-wide last:pr-0"
                >
                  {t("columns.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-border hover:bg-chrome relative border-t">
                  <td className="py-3 pr-4 last:pr-0">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-data focus-visible:ring-ring rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2"
                    >
                      {invoice.documentNumber}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 last:pr-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <InvoiceStatusBadge status={invoice.status} />
                      {invoice.supersededById !== null && (
                        <Badge tone="outline">{t("superseded")}</Badge>
                      )}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right last:pr-0">
                    <span className="font-data text-muted-foreground tabular-nums">
                      {formatCalendarDate(invoice.dueOn, { dateStyle: "medium" }, locale)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right last:pr-0">
                    <span className="font-data tabular-nums">
                      {formatMoney(invoice.total, locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invoices.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void fetchNextPage()}
          disabled={!hasNextPage || isFetchingNextPage}
          className="self-start"
        >
          {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
        </Button>
      )}
    </section>
  );
}
